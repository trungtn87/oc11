import sqlite3
import unicodedata
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .database import connect

router = APIRouter(prefix="/api/cost", tags=["cost"])


class RecipeItemInput(BaseModel):
    item_id: int
    unit_id: int
    quantity: float = Field(gt=0)


class RecipeInput(BaseModel):
    output_quantity: float = Field(gt=0)
    output_unit_id: int
    waste_percent: float = Field(default=5, ge=0, le=100)
    alert_threshold_percent: float = Field(default=5, gt=0, le=100)
    is_active: bool = True
    items: list[RecipeItemInput] = Field(min_length=1)


class ServiceOptionInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True
    recipe: RecipeInput | None = None


class RecipeItemOutput(BaseModel):
    id: int
    item_id: int
    item_name: str
    unit_id: int
    unit_name: str
    quantity: float
    conversion_factor: float
    quantity_in_smallest_unit: float
    smallest_unit_id: int
    smallest_unit_name: str
    current_price_per_smallest_unit: float | None
    line_cost: float | None
    price_source_receipt_code: str | None
    price_source_receipt_time: str | None


class RecipeOutput(BaseModel):
    id: int
    service_option_id: int
    output_quantity: float
    output_unit_id: int
    output_unit_name: str
    waste_percent: float
    alert_threshold_percent: float
    is_active: bool
    reference_unit_cost: float | None
    base_cost: float | None
    total_cost: float | None
    current_unit_cost: float | None
    change_percent: float | None
    cost_complete: bool
    has_open_alert: bool
    items: list[RecipeItemOutput]


class ServiceOptionOutput(BaseModel):
    id: int
    name: str
    note: str | None
    display_order: int
    is_active: bool
    recipe: RecipeOutput | None


class CostAlertOutput(BaseModel):
    id: int
    recipe_id: int
    service_option_id: int
    service_option_name: str
    reference_unit_cost: float
    current_unit_cost: float
    change_percent: float
    alert_threshold_percent: float
    status: str
    detected_at: str
    resolved_at: str | None


class IngredientPriceOutput(BaseModel):
    item_id: int
    item_name: str
    smallest_unit_id: int
    smallest_unit_name: str
    current_price_per_smallest_unit: float | None
    price_source_receipt_code: str | None
    price_source_receipt_time: str | None


def clean_name(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = unicodedata.normalize("NFC", value.strip())
    return cleaned or None


def name_key(value: str) -> str:
    return clean_name(value).casefold()


def ensure_service_option_name_unique(
    connection: sqlite3.Connection,
    name: str,
    exclude_id: int | None = None,
) -> None:
    requested = name_key(name)
    rows = connection.execute("SELECT id, name FROM service_options").fetchall()
    for row in rows:
        if exclude_id is not None and int(row["id"]) == exclude_id:
            continue
        if name_key(row["name"]) == requested:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên kiểu chế biến đã tồn tại.",
            )


def ensure_unit(connection: sqlite3.Connection, unit_id: int) -> sqlite3.Row:
    row = connection.execute(
        "SELECT id, name, is_active FROM units WHERE id = ?",
        (unit_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đơn vị tính không tồn tại.",
        )
    return row


def get_item_conversion(
    connection: sqlite3.Connection,
    item_id: int,
    unit_id: int,
) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT
            i.id AS item_id,
            i.name AS item_name,
            i.is_active AS item_active,
            i.smallest_unit_id,
            su.name AS smallest_unit_name,
            c.unit_id,
            u.name AS unit_name,
            c.quantity_in_smallest_unit AS conversion_factor,
            c.is_active AS conversion_active
        FROM items AS i
        JOIN units AS su ON su.id = i.smallest_unit_id
        JOIN item_unit_conversions AS c ON c.item_id = i.id
        JOIN units AS u ON u.id = c.unit_id
        WHERE i.id = ? AND c.unit_id = ?
        """,
        (item_id, unit_id),
    ).fetchone()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nguyên liệu chưa có quy đổi cho đơn vị đã chọn.",
        )
    if not bool(row["item_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Hàng hóa {row['item_name']} đang ngừng sử dụng.",
        )
    if not bool(row["conversion_active"]):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Đơn vị {row['unit_name']} đang ngừng sử dụng cho {row['item_name']}.",
        )
    return row


def latest_item_cost(
    connection: sqlite3.Connection,
    item_id: int,
) -> dict[str, float | str | None]:
    row = connection.execute(
        """
        SELECT
            pri.line_total,
            pri.quantity_in_smallest_unit,
            r.goods_total,
            r.shipping_fee,
            r.receipt_code,
            r.receipt_time
        FROM purchase_receipt_items AS pri
        JOIN purchase_receipts AS r ON r.id = pri.purchase_receipt_id
        WHERE pri.item_id = ?
          AND r.is_void = 0
        ORDER BY r.receipt_time DESC, pri.id DESC
        LIMIT 1
        """,
        (item_id,),
    ).fetchone()

    if row is None or float(row["quantity_in_smallest_unit"]) <= 0:
        return {
            "price": None,
            "receipt_code": None,
            "receipt_time": None,
        }

    line_total = float(row["line_total"])
    goods_total = float(row["goods_total"])
    shipping_fee = float(row["shipping_fee"])
    shipping_share = (
        shipping_fee * line_total / goods_total
        if goods_total > 0 and shipping_fee > 0
        else 0.0
    )
    effective_line_total = line_total + shipping_share
    price = effective_line_total / float(row["quantity_in_smallest_unit"])

    return {
        "price": price,
        "receipt_code": row["receipt_code"],
        "receipt_time": row["receipt_time"],
    }


def select_recipe(connection: sqlite3.Connection, recipe_id: int) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            r.id,
            r.service_option_id,
            r.output_quantity,
            r.output_unit_id,
            u.name AS output_unit_name,
            r.waste_percent,
            r.alert_threshold_percent,
            r.reference_unit_cost,
            r.is_active
        FROM recipes AS r
        JOIN units AS u ON u.id = r.output_unit_id
        WHERE r.id = ?
        """,
        (recipe_id,),
    ).fetchone()


def select_recipe_by_option(
    connection: sqlite3.Connection,
    service_option_id: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            r.id,
            r.service_option_id,
            r.output_quantity,
            r.output_unit_id,
            u.name AS output_unit_name,
            r.waste_percent,
            r.alert_threshold_percent,
            r.reference_unit_cost,
            r.is_active
        FROM recipes AS r
        JOIN units AS u ON u.id = r.output_unit_id
        WHERE r.service_option_id = ?
        """,
        (service_option_id,),
    ).fetchone()


def select_recipe_items(
    connection: sqlite3.Connection,
    recipe_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            ri.id,
            ri.item_id,
            i.name AS item_name,
            ri.unit_id,
            u.name AS unit_name,
            ri.quantity,
            c.quantity_in_smallest_unit AS conversion_factor,
            i.smallest_unit_id,
            su.name AS smallest_unit_name
        FROM recipe_items AS ri
        JOIN items AS i ON i.id = ri.item_id
        JOIN units AS u ON u.id = ri.unit_id
        JOIN units AS su ON su.id = i.smallest_unit_id
        JOIN item_unit_conversions AS c
          ON c.item_id = ri.item_id
         AND c.unit_id = ri.unit_id
        WHERE ri.recipe_id = ?
        ORDER BY ri.id ASC
        """,
        (recipe_id,),
    ).fetchall()


def calculate_recipe(
    connection: sqlite3.Connection,
    recipe: sqlite3.Row,
) -> tuple[list[RecipeItemOutput], float | None, float | None, float | None, bool]:
    item_outputs: list[RecipeItemOutput] = []
    base_cost = 0.0
    complete = True

    for row in select_recipe_items(connection, int(recipe["id"])):
        price = latest_item_cost(connection, int(row["item_id"]))
        quantity_in_smallest = float(row["quantity"]) * float(row["conversion_factor"])
        current_price = price["price"]
        line_cost = (
            quantity_in_smallest * float(current_price)
            if current_price is not None
            else None
        )
        if line_cost is None:
            complete = False
        else:
            base_cost += line_cost

        item_outputs.append(
            RecipeItemOutput(
                id=int(row["id"]),
                item_id=int(row["item_id"]),
                item_name=row["item_name"],
                unit_id=int(row["unit_id"]),
                unit_name=row["unit_name"],
                quantity=float(row["quantity"]),
                conversion_factor=float(row["conversion_factor"]),
                quantity_in_smallest_unit=quantity_in_smallest,
                smallest_unit_id=int(row["smallest_unit_id"]),
                smallest_unit_name=row["smallest_unit_name"],
                current_price_per_smallest_unit=(
                    float(current_price) if current_price is not None else None
                ),
                line_cost=line_cost,
                price_source_receipt_code=price["receipt_code"],
                price_source_receipt_time=price["receipt_time"],
            )
        )

    if not item_outputs:
        complete = False

    if not complete:
        return item_outputs, None, None, None, False

    total_cost = base_cost * (1 + float(recipe["waste_percent"]) / 100)
    unit_cost = total_cost / float(recipe["output_quantity"])
    return item_outputs, base_cost, total_cost, unit_cost, True


def open_alert_exists(connection: sqlite3.Connection, recipe_id: int) -> bool:
    row = connection.execute(
        """
        SELECT id
        FROM cost_alerts
        WHERE recipe_id = ? AND status = 'OPEN'
        LIMIT 1
        """,
        (recipe_id,),
    ).fetchone()
    return row is not None


def recipe_to_output(
    connection: sqlite3.Connection,
    recipe: sqlite3.Row,
) -> RecipeOutput:
    items, base_cost, total_cost, current_unit_cost, complete = calculate_recipe(
        connection,
        recipe,
    )
    reference = recipe["reference_unit_cost"]
    change_percent = None
    if (
        complete
        and current_unit_cost is not None
        and reference is not None
        and float(reference) > 0
    ):
        change_percent = (
            (current_unit_cost - float(reference)) / float(reference) * 100
        )

    return RecipeOutput(
        id=int(recipe["id"]),
        service_option_id=int(recipe["service_option_id"]),
        output_quantity=float(recipe["output_quantity"]),
        output_unit_id=int(recipe["output_unit_id"]),
        output_unit_name=recipe["output_unit_name"],
        waste_percent=float(recipe["waste_percent"]),
        alert_threshold_percent=float(recipe["alert_threshold_percent"]),
        is_active=bool(recipe["is_active"]),
        reference_unit_cost=(
            float(reference) if reference is not None else None
        ),
        base_cost=base_cost,
        total_cost=total_cost,
        current_unit_cost=current_unit_cost,
        change_percent=change_percent,
        cost_complete=complete,
        has_open_alert=open_alert_exists(connection, int(recipe["id"])),
        items=items,
    )


def normalize_recipe_items(
    connection: sqlite3.Connection,
    items: list[RecipeItemInput],
) -> list[RecipeItemInput]:
    seen: set[tuple[int, int]] = set()
    for line in items:
        key = (line.item_id, line.unit_id)
        if key in seen:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Một nguyên liệu cùng đơn vị chỉ được khai báo một lần.",
            )
        seen.add(key)
        get_item_conversion(connection, line.item_id, line.unit_id)
    return items


def recipe_definition_signature(
    connection: sqlite3.Connection,
    recipe: sqlite3.Row,
) -> tuple:
    lines = select_recipe_items(connection, int(recipe["id"]))
    return (
        round(float(recipe["output_quantity"]), 9),
        int(recipe["output_unit_id"]),
        round(float(recipe["waste_percent"]), 9),
        tuple(
            (
                int(line["item_id"]),
                int(line["unit_id"]),
                round(float(line["quantity"]), 9),
            )
            for line in lines
        ),
    )


def payload_definition_signature(payload: RecipeInput) -> tuple:
    return (
        round(float(payload.output_quantity), 9),
        int(payload.output_unit_id),
        round(float(payload.waste_percent), 9),
        tuple(
            (
                int(line.item_id),
                int(line.unit_id),
                round(float(line.quantity), 9),
            )
            for line in payload.items
        ),
    )


def set_reference_to_current(
    connection: sqlite3.Connection,
    recipe_id: int,
) -> float | None:
    recipe = select_recipe(connection, recipe_id)
    if recipe is None:
        return None

    _, _, _, current_unit_cost, complete = calculate_recipe(connection, recipe)
    if not complete or current_unit_cost is None:
        connection.execute(
            "UPDATE recipes SET reference_unit_cost = NULL WHERE id = ?",
            (recipe_id,),
        )
        connection.execute(
            """
            UPDATE cost_alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
            WHERE recipe_id = ? AND status = 'OPEN'
            """,
            (recipe_id,),
        )
        return None

    connection.execute(
        "UPDATE recipes SET reference_unit_cost = ? WHERE id = ?",
        (current_unit_cost, recipe_id),
    )
    connection.execute(
        """
        UPDATE cost_alerts
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
        WHERE recipe_id = ? AND status = 'OPEN'
        """,
        (recipe_id,),
    )
    return current_unit_cost


def upsert_recipe(
    connection: sqlite3.Connection,
    service_option_id: int,
    payload: RecipeInput,
) -> int:
    ensure_unit(connection, payload.output_unit_id)
    normalize_recipe_items(connection, payload.items)

    existing = select_recipe_by_option(connection, service_option_id)
    definition_changed = True

    if existing is None:
        cursor = connection.execute(
            """
            INSERT INTO recipes (
                service_option_id,
                output_quantity,
                output_unit_id,
                waste_percent,
                alert_threshold_percent,
                reference_unit_cost,
                is_active
            )
            VALUES (?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                service_option_id,
                payload.output_quantity,
                payload.output_unit_id,
                payload.waste_percent,
                payload.alert_threshold_percent,
                int(payload.is_active),
            ),
        )
        recipe_id = int(cursor.lastrowid)
    else:
        recipe_id = int(existing["id"])
        definition_changed = (
            recipe_definition_signature(connection, existing)
            != payload_definition_signature(payload)
        )
        connection.execute(
            """
            UPDATE recipes
            SET output_quantity = ?,
                output_unit_id = ?,
                waste_percent = ?,
                alert_threshold_percent = ?,
                is_active = ?
            WHERE id = ?
            """,
            (
                payload.output_quantity,
                payload.output_unit_id,
                payload.waste_percent,
                payload.alert_threshold_percent,
                int(payload.is_active),
                recipe_id,
            ),
        )
        connection.execute("DELETE FROM recipe_items WHERE recipe_id = ?", (recipe_id,))

    for line in payload.items:
        connection.execute(
            """
            INSERT INTO recipe_items (recipe_id, item_id, unit_id, quantity)
            VALUES (?, ?, ?, ?)
            """,
            (recipe_id, line.item_id, line.unit_id, line.quantity),
        )

    if existing is None or definition_changed:
        set_reference_to_current(connection, recipe_id)

    return recipe_id


def refresh_recipe_alert(connection: sqlite3.Connection, recipe_id: int) -> None:
    recipe = select_recipe(connection, recipe_id)
    if recipe is None or not bool(recipe["is_active"]):
        connection.execute(
            """
            UPDATE cost_alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
            WHERE recipe_id = ? AND status = 'OPEN'
            """,
            (recipe_id,),
        )
        return

    _, _, _, current_unit_cost, complete = calculate_recipe(connection, recipe)
    if not complete or current_unit_cost is None:
        return

    reference = recipe["reference_unit_cost"]
    if reference is None or float(reference) <= 0:
        connection.execute(
            "UPDATE recipes SET reference_unit_cost = ? WHERE id = ?",
            (current_unit_cost, recipe_id),
        )
        return

    reference_value = float(reference)
    change_percent = (current_unit_cost - reference_value) / reference_value * 100
    threshold = float(recipe["alert_threshold_percent"])

    open_alert = connection.execute(
        """
        SELECT id
        FROM cost_alerts
        WHERE recipe_id = ? AND status = 'OPEN'
        LIMIT 1
        """,
        (recipe_id,),
    ).fetchone()

    if change_percent >= threshold:
        if open_alert is None:
            connection.execute(
                """
                INSERT INTO cost_alerts (
                    recipe_id,
                    reference_unit_cost,
                    current_unit_cost,
                    change_percent,
                    status,
                    detected_at
                )
                VALUES (?, ?, ?, ?, 'OPEN', CURRENT_TIMESTAMP)
                """,
                (recipe_id, reference_value, current_unit_cost, change_percent),
            )
        else:
            connection.execute(
                """
                UPDATE cost_alerts
                SET current_unit_cost = ?,
                    change_percent = ?
                WHERE id = ?
                """,
                (current_unit_cost, change_percent, int(open_alert["id"])),
            )
    elif open_alert is not None:
        connection.execute(
            """
            UPDATE cost_alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(open_alert["id"]),),
        )


def refresh_cost_alerts_for_items(item_ids: list[int] | None = None) -> None:
    with connect() as connection:
        if item_ids:
            placeholders = ",".join("?" for _ in item_ids)
            rows = connection.execute(
                f"""
                SELECT DISTINCT r.id
                FROM recipes AS r
                JOIN recipe_items AS ri ON ri.recipe_id = r.id
                WHERE ri.item_id IN ({placeholders})
                """,
                tuple(item_ids),
            ).fetchall()
        else:
            rows = connection.execute("SELECT id FROM recipes").fetchall()

        for row in rows:
            refresh_recipe_alert(connection, int(row["id"]))
        connection.commit()


def service_option_to_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> ServiceOptionOutput:
    recipe = select_recipe_by_option(connection, int(row["id"]))
    return ServiceOptionOutput(
        id=int(row["id"]),
        name=row["name"],
        note=row["note"],
        display_order=int(row["display_order"]),
        is_active=bool(row["is_active"]),
        recipe=recipe_to_output(connection, recipe) if recipe is not None else None,
    )


@router.get("/service-options", response_model=list[ServiceOptionOutput])
def list_service_options() -> list[ServiceOptionOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, note, display_order, is_active
            FROM service_options
            ORDER BY is_active DESC, display_order ASC, name ASC
            """
        ).fetchall()
        return [service_option_to_output(connection, row) for row in rows]


@router.post(
    "/service-options",
    response_model=ServiceOptionOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_service_option(payload: ServiceOptionInput) -> ServiceOptionOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên kiểu chế biến không được để trống.",
        )

    with connect() as connection:
        ensure_service_option_name_unique(connection, name)
        cursor = connection.execute(
            """
            INSERT INTO service_options (
                name, note, display_order, is_active
            )
            VALUES (?, ?, ?, ?)
            """,
            (name, clean_optional(payload.note), payload.display_order, int(payload.is_active)),
        )
        option_id = int(cursor.lastrowid)

        if payload.recipe is not None:
            upsert_recipe(connection, option_id, payload.recipe)

        connection.commit()
        row = connection.execute(
            """
            SELECT id, name, note, display_order, is_active
            FROM service_options
            WHERE id = ?
            """,
            (option_id,),
        ).fetchone()
        assert row is not None
        output = service_option_to_output(connection, row)

    backup_database(reason="cost-service-option-created")
    return output


@router.put("/service-options/{option_id}", response_model=ServiceOptionOutput)
def update_service_option(
    option_id: int,
    payload: ServiceOptionInput,
) -> ServiceOptionOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên kiểu chế biến không được để trống.",
        )

    with connect() as connection:
        existing = connection.execute(
            "SELECT id FROM service_options WHERE id = ?",
            (option_id,),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy kiểu chế biến.",
            )

        ensure_service_option_name_unique(connection, name, exclude_id=option_id)
        connection.execute(
            """
            UPDATE service_options
            SET name = ?, note = ?, display_order = ?, is_active = ?
            WHERE id = ?
            """,
            (
                name,
                clean_optional(payload.note),
                payload.display_order,
                int(payload.is_active),
                option_id,
            ),
        )

        existing_recipe = select_recipe_by_option(connection, option_id)
        if payload.recipe is None:
            if existing_recipe is not None:
                connection.execute(
                    "DELETE FROM recipes WHERE id = ?",
                    (int(existing_recipe["id"]),),
                )
        else:
            recipe_id = upsert_recipe(connection, option_id, payload.recipe)
            refresh_recipe_alert(connection, recipe_id)

        connection.commit()
        row = connection.execute(
            """
            SELECT id, name, note, display_order, is_active
            FROM service_options
            WHERE id = ?
            """,
            (option_id,),
        ).fetchone()
        assert row is not None
        output = service_option_to_output(connection, row)

    backup_database(reason="cost-service-option-updated")
    return output


@router.get("/ingredient-prices", response_model=list[IngredientPriceOutput])
def list_ingredient_prices() -> list[IngredientPriceOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT
                i.id,
                i.name,
                i.smallest_unit_id,
                u.name AS smallest_unit_name
            FROM items AS i
            JOIN units AS u ON u.id = i.smallest_unit_id
            WHERE i.is_active = 1
            ORDER BY i.name ASC
            """
        ).fetchall()

        output: list[IngredientPriceOutput] = []
        for row in rows:
            price = latest_item_cost(connection, int(row["id"]))
            output.append(
                IngredientPriceOutput(
                    item_id=int(row["id"]),
                    item_name=row["name"],
                    smallest_unit_id=int(row["smallest_unit_id"]),
                    smallest_unit_name=row["smallest_unit_name"],
                    current_price_per_smallest_unit=(
                        float(price["price"]) if price["price"] is not None else None
                    ),
                    price_source_receipt_code=price["receipt_code"],
                    price_source_receipt_time=price["receipt_time"],
                )
            )
        return output


@router.get("/alerts", response_model=list[CostAlertOutput])
def list_cost_alerts(include_resolved: bool = False) -> list[CostAlertOutput]:
    refresh_cost_alerts_for_items()

    with connect() as connection:
        where = "" if include_resolved else "WHERE a.status = 'OPEN'"
        rows = connection.execute(
            f"""
            SELECT
                a.id,
                a.recipe_id,
                r.service_option_id,
                so.name AS service_option_name,
                a.reference_unit_cost,
                a.current_unit_cost,
                a.change_percent,
                r.alert_threshold_percent,
                a.status,
                a.detected_at,
                a.resolved_at
            FROM cost_alerts AS a
            JOIN recipes AS r ON r.id = a.recipe_id
            JOIN service_options AS so ON so.id = r.service_option_id
            {where}
            ORDER BY
                CASE WHEN a.status = 'OPEN' THEN 0 ELSE 1 END,
                a.detected_at DESC,
                a.id DESC
            """
        ).fetchall()

        return [
            CostAlertOutput(
                id=int(row["id"]),
                recipe_id=int(row["recipe_id"]),
                service_option_id=int(row["service_option_id"]),
                service_option_name=row["service_option_name"],
                reference_unit_cost=float(row["reference_unit_cost"]),
                current_unit_cost=float(row["current_unit_cost"]),
                change_percent=float(row["change_percent"]),
                alert_threshold_percent=float(row["alert_threshold_percent"]),
                status=row["status"],
                detected_at=row["detected_at"],
                resolved_at=row["resolved_at"],
            )
            for row in rows
        ]


@router.post("/recipes/{recipe_id}/accept-current-cost", response_model=RecipeOutput)
def accept_current_cost(recipe_id: int) -> RecipeOutput:
    with connect() as connection:
        recipe = select_recipe(connection, recipe_id)
        if recipe is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy công thức.",
            )

        _, _, _, current_unit_cost, complete = calculate_recipe(connection, recipe)
        if not complete or current_unit_cost is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chưa đủ giá nguyên liệu để cập nhật mốc Cost.",
            )

        set_reference_to_current(connection, recipe_id)
        connection.commit()
        updated = select_recipe(connection, recipe_id)
        assert updated is not None
        output = recipe_to_output(connection, updated)

    backup_database(reason="cost-reference-updated")
    return output
