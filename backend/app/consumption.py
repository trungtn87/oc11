from collections import defaultdict
from datetime import date, datetime, time

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .cost_recipes import get_item_conversion, select_recipe, select_recipe_items
from .database import connect
from .inventory import current_quantity, last_reconciliation
from .menu import select_components, select_menu_ingredients

router = APIRouter(prefix="/api/inventory/consumption", tags=["inventory-consumption"])


class ConsumptionPreviewInput(BaseModel):
    menu_item_id: int | None = None
    menu_item_option_id: int | None = None
    quantity: float = Field(gt=0)


class ConsumptionBreakdownItem(BaseModel):
    item_id: int
    item_name: str
    item_group_name: str
    smallest_unit_id: int
    smallest_unit_name: str
    quantity: float


class ConsumptionPreviewOutput(BaseModel):
    menu_item_id: int
    menu_item_name: str
    menu_item_option_id: int | None
    service_option_id: int | None
    service_option_name: str | None
    sale_unit_name: str
    sold_quantity: float
    items: list[ConsumptionBreakdownItem]


class ConsumptionSummaryItem(BaseModel):
    item_id: int
    item_name: str
    item_group_id: int
    item_group_name: str
    smallest_unit_id: int
    smallest_unit_name: str
    consumed_quantity: float
    sale_line_count: int
    last_sale_time: str | None
    stock_quantity: float
    last_reconciled_at: str | None
    last_reconciled_quantity: float | None


class ConsumptionSummaryOutput(BaseModel):
    from_time: str
    to_time: str
    items: list[ConsumptionSummaryItem]


def normalize_datetime(value: str, *, end_of_day: bool = False) -> str:
    cleaned = value.strip()
    try:
        if len(cleaned) == 10:
            parsed_date = date.fromisoformat(cleaned)
            parsed = datetime.combine(
                parsed_date,
                time.max if end_of_day else time.min,
            )
        else:
            parsed = datetime.fromisoformat(cleaned)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thời gian không hợp lệ.",
        ) from exc

    return parsed.isoformat(timespec="microseconds")


def option_identity(connection, menu_item_option_id: int):
    row = connection.execute(
        """
        SELECT
            mio.id,
            mi.id AS menu_item_id,
            mi.name AS menu_item_name,
            mi.sale_unit_id,
            su.name AS sale_unit_name,
            mio.service_option_id,
            so.name AS service_option_name
        FROM menu_item_options AS mio
        JOIN menu_items AS mi ON mi.id = mio.menu_item_id
        JOIN units AS su ON su.id = mi.sale_unit_id
        JOIN service_options AS so ON so.id = mio.service_option_id
        WHERE mio.id = ?
        """,
        (menu_item_option_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy món/kiểu chế biến.",
        )
    return row


def menu_item_identity(connection, menu_item_id: int):
    row = connection.execute(
        """
        SELECT
            mi.id AS menu_item_id,
            mi.name AS menu_item_name,
            mi.sale_unit_id,
            su.name AS sale_unit_name
        FROM menu_items AS mi
        JOIN units AS su ON su.id = mi.sale_unit_id
        WHERE mi.id = ?
        """,
        (menu_item_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy món.",
        )
    return row


def expand_menu_item_to_raw_items(
    connection,
    menu_item_id: int,
    sold_quantity: float,
) -> list[ConsumptionBreakdownItem]:
    identity = menu_item_identity(connection, menu_item_id)
    ingredients = select_menu_ingredients(connection, int(identity["menu_item_id"]))
    if not ingredients:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Món chưa có nguyên liệu trừ kho.",
        )

    quantities: dict[int, float] = defaultdict(float)
    for ingredient in ingredients:
        item_id = int(ingredient["item_id"])
        conversion = get_item_conversion(
            connection,
            item_id,
            int(ingredient["unit_id"]),
        )
        quantities[item_id] += (
            float(ingredient["quantity"])
            * sold_quantity
            * float(conversion["conversion_factor"])
        )

    placeholders = ",".join("?" for _ in quantities)
    rows = connection.execute(
        f"""
        SELECT
            i.id,
            i.name,
            i.item_group_id,
            g.name AS item_group_name,
            i.smallest_unit_id,
            u.name AS smallest_unit_name
        FROM items AS i
        JOIN item_groups AS g ON g.id = i.item_group_id
        JOIN units AS u ON u.id = i.smallest_unit_id
        WHERE i.id IN ({placeholders})
        ORDER BY g.name COLLATE NOCASE ASC, i.name COLLATE NOCASE ASC
        """,
        tuple(quantities.keys()),
    ).fetchall()

    return [
        ConsumptionBreakdownItem(
            item_id=int(row["id"]),
            item_name=row["name"],
            item_group_name=row["item_group_name"],
            smallest_unit_id=int(row["smallest_unit_id"]),
            smallest_unit_name=row["smallest_unit_name"],
            quantity=quantities[int(row["id"])],
        )
        for row in rows
    ]


def expand_menu_option_to_raw_items(
    connection,
    menu_item_option_id: int,
    sold_quantity: float,
) -> list[ConsumptionBreakdownItem]:
    identity = option_identity(connection, menu_item_option_id)
    ingredients = select_menu_ingredients(connection, int(identity["menu_item_id"]))
    components = select_components(connection, menu_item_option_id)
    if not ingredients and not components:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Món/kiểu chế biến chưa có định lượng.",
        )

    quantities: dict[int, float] = defaultdict(float)

    for ingredient in ingredients:
        item_id = int(ingredient["item_id"])
        conversion = get_item_conversion(
            connection,
            item_id,
            int(ingredient["unit_id"]),
        )
        quantities[item_id] += (
            float(ingredient["quantity"])
            * sold_quantity
            * float(conversion["conversion_factor"])
        )

    for component in components:
        component_type = component["component_type"]
        component_qty = float(component["quantity"]) * sold_quantity

        if component_type == "ITEM":
            item_id = int(component["item_id"])
            conversion = get_item_conversion(
                connection,
                item_id,
                int(component["unit_id"]),
            )
            quantities[item_id] += (
                component_qty * float(conversion["conversion_factor"])
            )
            continue

        recipe = select_recipe(connection, int(component["recipe_id"]))
        if recipe is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Bán thành phẩm trong định lượng không còn công thức.",
            )

        output_quantity = float(recipe["output_quantity"])
        if output_quantity <= 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Sản lượng công thức bán thành phẩm không hợp lệ.",
            )

        recipe_factor = component_qty / output_quantity

        for recipe_item in select_recipe_items(connection, int(recipe["id"])):
            item_id = int(recipe_item["item_id"])
            raw_quantity = (
                float(recipe_item["quantity"])
                * float(recipe_item["conversion_factor"])
                * recipe_factor
            )
            quantities[item_id] += raw_quantity

    if not quantities:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Không thể bung định lượng thành nguyên liệu kho.",
        )

    placeholders = ",".join("?" for _ in quantities)
    rows = connection.execute(
        f"""
        SELECT
            i.id,
            i.name,
            i.item_group_id,
            g.name AS item_group_name,
            i.smallest_unit_id,
            u.name AS smallest_unit_name
        FROM items AS i
        JOIN item_groups AS g ON g.id = i.item_group_id
        JOIN units AS u ON u.id = i.smallest_unit_id
        WHERE i.id IN ({placeholders})
        ORDER BY g.name COLLATE NOCASE ASC, i.name COLLATE NOCASE ASC
        """,
        tuple(quantities.keys()),
    ).fetchall()

    return [
        ConsumptionBreakdownItem(
            item_id=int(row["id"]),
            item_name=row["name"],
            item_group_name=row["item_group_name"],
            smallest_unit_id=int(row["smallest_unit_id"]),
            smallest_unit_name=row["smallest_unit_name"],
            quantity=quantities[int(row["id"])],
        )
        for row in rows
    ]


def record_sale_consumption(
    connection,
    *,
    source_id: str,
    source_line_id: str,
    movement_time: str,
    sold_quantity: float,
    menu_item_option_id: int | None = None,
    menu_item_id: int | None = None,
) -> None:
    """
    Internal service for the future POS/sales module.
    One sales line is expanded and snapshotted into inventory_movements.
    Retrying the same source line replaces its SALE movements, preventing duplicates.
    """
    if menu_item_option_id is not None:
        identity = option_identity(connection, menu_item_option_id)
        menu_item_id = int(identity["menu_item_id"])
        service_option_name = identity["service_option_name"]
        items = expand_menu_option_to_raw_items(
            connection,
            menu_item_option_id,
            sold_quantity,
        )
    elif menu_item_id is not None:
        identity = menu_item_identity(connection, menu_item_id)
        service_option_name = None
        items = expand_menu_item_to_raw_items(
            connection,
            menu_item_id,
            sold_quantity,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cần menu_item_id hoặc menu_item_option_id để trừ kho.",
        )

    connection.execute(
        """
        DELETE FROM inventory_movements
        WHERE source_type = 'SALE'
          AND source_id = ?
          AND source_line_id = ?
        """,
        (source_id, source_line_id),
    )

    note = f"Bán {identity['menu_item_name']}"
    if service_option_name:
        note += f" - {service_option_name}"
    note += f" x {sold_quantity:g}"
    for item in items:
        connection.execute(
            """
            INSERT INTO inventory_movements (
                item_id,
                movement_time,
                quantity_delta,
                source_type,
                source_id,
                source_line_id,
                note,
                created_at
            )
            VALUES (?, ?, ?, 'SALE', ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                item.item_id,
                movement_time,
                -float(item.quantity),
                source_id,
                source_line_id,
                note,
            ),
        )


@router.post("/preview", response_model=ConsumptionPreviewOutput)
def preview_consumption(payload: ConsumptionPreviewInput) -> ConsumptionPreviewOutput:
    with connect() as connection:
        if payload.menu_item_option_id is not None:
            identity = option_identity(connection, payload.menu_item_option_id)
            if (
                payload.menu_item_id is not None
                and payload.menu_item_id != int(identity["menu_item_id"])
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Món và kiểu chế biến không khớp nhau.",
                )
            items = expand_menu_option_to_raw_items(
                connection,
                payload.menu_item_option_id,
                float(payload.quantity),
            )
            return ConsumptionPreviewOutput(
                menu_item_id=int(identity["menu_item_id"]),
                menu_item_name=identity["menu_item_name"],
                menu_item_option_id=int(identity["id"]),
                service_option_id=int(identity["service_option_id"]),
                service_option_name=identity["service_option_name"],
                sale_unit_name=identity["sale_unit_name"],
                sold_quantity=float(payload.quantity),
                items=items,
            )

        if payload.menu_item_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Cần chọn món để tính nguyên liệu trừ kho.",
            )

        identity = menu_item_identity(connection, payload.menu_item_id)
        items = expand_menu_item_to_raw_items(
            connection,
            payload.menu_item_id,
            float(payload.quantity),
        )
        return ConsumptionPreviewOutput(
            menu_item_id=int(identity["menu_item_id"]),
            menu_item_name=identity["menu_item_name"],
            menu_item_option_id=None,
            service_option_id=None,
            service_option_name=None,
            sale_unit_name=identity["sale_unit_name"],
            sold_quantity=float(payload.quantity),
            items=items,
        )


@router.get("", response_model=ConsumptionSummaryOutput)
def list_consumption(
    from_time: str = Query(alias="from"),
    to_time: str = Query(alias="to"),
    search: str | None = Query(default=None),
    group_id: int | None = Query(default=None),
) -> ConsumptionSummaryOutput:
    start = normalize_datetime(from_time, end_of_day=False)
    end = normalize_datetime(to_time, end_of_day=True)

    if start > end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Từ ngày phải nhỏ hơn hoặc bằng đến ngày.",
        )

    conditions: list[str] = []
    params: list[object] = []

    if group_id is not None:
        conditions.append("i.item_group_id = ?")
        params.append(group_id)

    if search and search.strip():
        conditions.append("i.name LIKE ? COLLATE NOCASE")
        params.append(f"%{search.strip()}%")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with connect() as connection:
        rows = connection.execute(
            f"""
            SELECT
                i.id,
                i.name,
                i.item_group_id,
                g.name AS item_group_name,
                i.smallest_unit_id,
                u.name AS smallest_unit_name,
                COALESCE(
                    SUM(
                        CASE
                            WHEN m.source_type = 'SALE'
                             AND m.movement_time >= ?
                             AND m.movement_time <= ?
                            THEN -m.quantity_delta
                            ELSE 0
                        END
                    ),
                    0
                ) AS consumed_quantity,
                COUNT(
                    DISTINCT CASE
                        WHEN m.source_type = 'SALE'
                         AND m.movement_time >= ?
                         AND m.movement_time <= ?
                        THEN COALESCE(m.source_id, '') || ':' ||
                             COALESCE(m.source_line_id, '')
                        ELSE NULL
                    END
                ) AS sale_line_count,
                MAX(
                    CASE
                        WHEN m.source_type = 'SALE'
                         AND m.movement_time >= ?
                         AND m.movement_time <= ?
                        THEN m.movement_time
                        ELSE NULL
                    END
                ) AS last_sale_time
            FROM items AS i
            JOIN item_groups AS g ON g.id = i.item_group_id
            JOIN units AS u ON u.id = i.smallest_unit_id
            LEFT JOIN inventory_movements AS m ON m.item_id = i.id
            {where}
            GROUP BY
                i.id,
                i.name,
                i.item_group_id,
                g.name,
                i.smallest_unit_id,
                u.name
            ORDER BY
                consumed_quantity DESC,
                i.name COLLATE NOCASE ASC
            """,
            (start, end, start, end, start, end, *params),
        ).fetchall()

        result: list[ConsumptionSummaryItem] = []
        now = datetime.now().isoformat(timespec="microseconds")
        for row in rows:
            reconciliation = last_reconciliation(
                connection,
                int(row["id"]),
                as_of=now,
            )
            result.append(
                ConsumptionSummaryItem(
                    item_id=int(row["id"]),
                    item_name=row["name"],
                    item_group_id=int(row["item_group_id"]),
                    item_group_name=row["item_group_name"],
                    smallest_unit_id=int(row["smallest_unit_id"]),
                    smallest_unit_name=row["smallest_unit_name"],
                    consumed_quantity=float(row["consumed_quantity"]),
                    sale_line_count=int(row["sale_line_count"]),
                    last_sale_time=row["last_sale_time"],
                    stock_quantity=current_quantity(connection, int(row["id"])),
                    last_reconciled_at=(
                        reconciliation["adjustment_time"]
                        if reconciliation is not None
                        else None
                    ),
                    last_reconciled_quantity=(
                        float(reconciliation["actual_quantity"])
                        if reconciliation is not None
                        else None
                    ),
                )
            )

        return ConsumptionSummaryOutput(
            from_time=start,
            to_time=end,
            items=result,
        )
