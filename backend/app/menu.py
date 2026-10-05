import sqlite3
import unicodedata

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .backup import backup_database
from .cost_recipes import (
    calculate_recipe,
    get_item_conversion,
    latest_item_cost,
    select_recipe,
)
from .database import connect

router = APIRouter(prefix="/api/menu", tags=["menu"])


class MenuGroupInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True
    note: str | None = Field(default=None, max_length=500)


class MenuGroupOutput(MenuGroupInput):
    id: int


class MenuComponentInput(BaseModel):
    component_type: str
    item_id: int | None = None
    unit_id: int | None = None
    recipe_id: int | None = None
    quantity: float = Field(gt=0)


class MenuIngredientInput(BaseModel):
    item_id: int
    unit_id: int
    quantity: float = Field(gt=0)


class MenuItemOptionInput(BaseModel):
    service_option_id: int
    extra_price: int = Field(default=0, ge=0)
    alert_threshold_percent: float = Field(default=5, gt=0, le=100)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True
    components: list[MenuComponentInput] = Field(default_factory=list)


class MenuItemInput(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    menu_group_id: int
    sale_unit_id: int
    base_price: int = Field(default=0, ge=0)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True
    note: str | None = Field(default=None, max_length=500)
    ingredients: list[MenuIngredientInput] = Field(default_factory=list)
    options: list[MenuItemOptionInput] = Field(default_factory=list)


class MenuIngredientOutput(BaseModel):
    id: int
    item_id: int
    item_name: str
    unit_id: int
    unit_name: str
    quantity: float
    unit_cost: float | None
    line_cost: float | None
    cost_complete: bool


class MenuComponentOutput(BaseModel):
    id: int
    component_type: str
    item_id: int | None
    item_name: str | None
    unit_id: int | None
    unit_name: str | None
    recipe_id: int | None
    recipe_name: str | None
    recipe_output_unit_name: str | None
    quantity: float
    unit_cost: float | None
    line_cost: float | None
    cost_complete: bool


class MenuItemOptionOutput(BaseModel):
    id: int
    service_option_id: int
    service_option_name: str
    extra_price: int
    sale_price: int
    alert_threshold_percent: float
    display_order: int
    is_active: bool
    reference_cost: float | None
    current_cost: float | None
    change_percent: float | None
    cost_percent: float | None
    cost_complete: bool
    has_open_alert: bool
    components: list[MenuComponentOutput]


class MenuItemOutput(BaseModel):
    id: int
    name: str
    menu_group_id: int
    menu_group_name: str
    sale_unit_id: int
    sale_unit_name: str
    base_price: int
    display_order: int
    is_active: bool
    note: str | None
    ingredients: list[MenuIngredientOutput]
    options: list[MenuItemOptionOutput]


class MenuCostAlertOutput(BaseModel):
    id: int
    menu_item_option_id: int
    menu_item_id: int
    menu_item_name: str
    service_option_id: int
    service_option_name: str
    reference_cost: float
    current_cost: float
    change_percent: float
    alert_threshold_percent: float
    status: str
    detected_at: str
    resolved_at: str | None


def clean_name(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = unicodedata.normalize("NFC", value.strip())
    return cleaned or None


def name_key(value: str) -> str:
    return clean_name(value).casefold()


def ensure_group_name_unique(
    connection: sqlite3.Connection,
    name: str,
    exclude_id: int | None = None,
) -> None:
    requested = name_key(name)
    rows = connection.execute("SELECT id, name FROM menu_groups").fetchall()
    for row in rows:
        if exclude_id is not None and int(row["id"]) == exclude_id:
            continue
        if name_key(row["name"]) == requested:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên nhóm thực đơn đã tồn tại.",
            )


def ensure_menu_item_name_unique(
    connection: sqlite3.Connection,
    *,
    menu_group_id: int,
    name: str,
    exclude_id: int | None = None,
) -> None:
    requested = name_key(name)
    rows = connection.execute(
        "SELECT id, name FROM menu_items WHERE menu_group_id = ?",
        (menu_group_id,),
    ).fetchall()
    for row in rows:
        if exclude_id is not None and int(row["id"]) == exclude_id:
            continue
        if name_key(row["name"]) == requested:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Tên món đã tồn tại trong nhóm thực đơn này.",
            )


def ensure_group(connection: sqlite3.Connection, group_id: int) -> sqlite3.Row:
    row = connection.execute(
        "SELECT id, name FROM menu_groups WHERE id = ?",
        (group_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nhóm thực đơn không tồn tại.",
        )
    return row


def ensure_unit(connection: sqlite3.Connection, unit_id: int) -> sqlite3.Row:
    row = connection.execute(
        "SELECT id, name FROM units WHERE id = ?",
        (unit_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Đơn vị tính không tồn tại.",
        )
    return row


def ensure_service_option(
    connection: sqlite3.Connection,
    service_option_id: int,
) -> sqlite3.Row:
    row = connection.execute(
        "SELECT id, name FROM service_options WHERE id = ?",
        (service_option_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Kiểu chế biến không tồn tại.",
        )
    return row


def validate_component(
    connection: sqlite3.Connection,
    component: MenuComponentInput,
) -> None:
    component_type = component.component_type.strip().upper()
    if component_type == "ITEM":
        if component.item_id is None or component.unit_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nguyên liệu hàng hóa cần chọn hàng hóa và đơn vị.",
            )
        if component.recipe_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Thành phần hàng hóa không được gắn công thức sốt.",
            )
        get_item_conversion(connection, component.item_id, component.unit_id)
        return

    if component_type == "RECIPE":
        if component.recipe_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Bán thành phẩm cần chọn công thức.",
            )
        if component.item_id is not None or component.unit_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Bán thành phẩm không dùng hàng hóa/đơn vị hàng hóa.",
            )
        recipe = select_recipe(connection, component.recipe_id)
        if recipe is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Công thức bán thành phẩm không tồn tại.",
            )
        return

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Loại thành phần định lượng không hợp lệ.",
    )


def validate_ingredients(
    connection: sqlite3.Connection,
    ingredients: list[MenuIngredientInput],
) -> None:
    seen: set[tuple[int, int]] = set()
    for ingredient in ingredients:
        get_item_conversion(connection, ingredient.item_id, ingredient.unit_id)
        key = (ingredient.item_id, ingredient.unit_id)
        if key in seen:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Một nguyên liệu cùng đơn vị chỉ được khai báo một lần.",
            )
        seen.add(key)


def validate_options(
    connection: sqlite3.Connection,
    options: list[MenuItemOptionInput],
) -> None:
    seen_options: set[int] = set()
    for option in options:
        if option.service_option_id in seen_options:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Một kiểu chế biến chỉ được gán một lần cho món.",
            )
        seen_options.add(option.service_option_id)
        ensure_service_option(connection, option.service_option_id)

        seen_components: set[tuple] = set()
        for component in option.components:
            validate_component(connection, component)
            component_type = component.component_type.strip().upper()
            key = (
                component_type,
                component.item_id if component_type == "ITEM" else component.recipe_id,
                component.unit_id if component_type == "ITEM" else None,
            )
            if key in seen_components:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Một thành phần cùng đơn vị chỉ được khai báo một lần.",
                )
            seen_components.add(key)


def select_menu_item(
    connection: sqlite3.Connection,
    menu_item_id: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT
            mi.id,
            mi.name,
            mi.menu_group_id,
            mg.name AS menu_group_name,
            mi.sale_unit_id,
            u.name AS sale_unit_name,
            mi.base_price,
            mi.display_order,
            mi.is_active,
            mi.note
        FROM menu_items AS mi
        JOIN menu_groups AS mg ON mg.id = mi.menu_group_id
        JOIN units AS u ON u.id = mi.sale_unit_id
        WHERE mi.id = ?
        """,
        (menu_item_id,),
    ).fetchone()


def select_menu_ingredients(
    connection: sqlite3.Connection,
    menu_item_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            mii.id,
            mii.item_id,
            i.name AS item_name,
            mii.unit_id,
            u.name AS unit_name,
            mii.quantity
        FROM menu_item_ingredients AS mii
        JOIN items AS i ON i.id = mii.item_id
        JOIN units AS u ON u.id = mii.unit_id
        WHERE mii.menu_item_id = ?
        ORDER BY mii.id ASC
        """,
        (menu_item_id,),
    ).fetchall()


def select_components(
    connection: sqlite3.Connection,
    menu_item_option_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            mic.id,
            mic.component_type,
            mic.item_id,
            i.name AS item_name,
            mic.unit_id,
            u.name AS unit_name,
            mic.recipe_id,
            so.name AS recipe_name,
            ru.name AS recipe_output_unit_name,
            mic.quantity
        FROM menu_item_components AS mic
        LEFT JOIN items AS i ON i.id = mic.item_id
        LEFT JOIN units AS u ON u.id = mic.unit_id
        LEFT JOIN recipes AS r ON r.id = mic.recipe_id
        LEFT JOIN service_options AS so ON so.id = r.service_option_id
        LEFT JOIN units AS ru ON ru.id = r.output_unit_id
        WHERE mic.menu_item_option_id = ?
        ORDER BY mic.id ASC
        """,
        (menu_item_option_id,),
    ).fetchall()


def calculate_menu_ingredients(
    connection: sqlite3.Connection,
    menu_item_id: int,
) -> tuple[list[MenuIngredientOutput], float, bool]:
    rows = select_menu_ingredients(connection, menu_item_id)
    outputs: list[MenuIngredientOutput] = []
    total_cost = 0.0
    complete = True

    for row in rows:
        conversion = get_item_conversion(
            connection,
            int(row["item_id"]),
            int(row["unit_id"]),
        )
        price = latest_item_cost(connection, int(row["item_id"]))
        current_price = price["price"]
        unit_cost: float | None = None
        line_cost: float | None = None
        if current_price is not None:
            unit_cost = float(current_price) * float(conversion["conversion_factor"])
            line_cost = float(row["quantity"]) * unit_cost
            total_cost += line_cost
        else:
            complete = False

        outputs.append(
            MenuIngredientOutput(
                id=int(row["id"]),
                item_id=int(row["item_id"]),
                item_name=row["item_name"],
                unit_id=int(row["unit_id"]),
                unit_name=row["unit_name"],
                quantity=float(row["quantity"]),
                unit_cost=unit_cost,
                line_cost=line_cost,
                cost_complete=line_cost is not None,
            )
        )

    return outputs, total_cost, complete


def calculate_menu_option(
    connection: sqlite3.Connection,
    menu_item_option_id: int,
) -> tuple[list[MenuComponentOutput], float | None, bool]:
    option_row = connection.execute(
        "SELECT menu_item_id FROM menu_item_options WHERE id = ?",
        (menu_item_option_id,),
    ).fetchone()
    if option_row is None:
        return [], None, False

    base_ingredients, base_cost, base_complete = calculate_menu_ingredients(
        connection,
        int(option_row["menu_item_id"]),
    )
    rows = select_components(connection, menu_item_option_id)
    outputs: list[MenuComponentOutput] = []
    total_cost = base_cost
    complete = base_complete

    if not rows and not base_ingredients:
        complete = False

    for row in rows:
        component_type = row["component_type"]
        unit_cost: float | None = None
        line_cost: float | None = None

        if component_type == "ITEM":
            conversion = get_item_conversion(
                connection,
                int(row["item_id"]),
                int(row["unit_id"]),
            )
            price = latest_item_cost(connection, int(row["item_id"]))
            current_price = price["price"]
            if current_price is not None:
                unit_cost = float(current_price) * float(conversion["conversion_factor"])
                line_cost = float(row["quantity"]) * unit_cost
        else:
            recipe = select_recipe(connection, int(row["recipe_id"]))
            if recipe is not None:
                _, _, _, recipe_unit_cost, recipe_complete = calculate_recipe(
                    connection,
                    recipe,
                )
                if recipe_complete and recipe_unit_cost is not None:
                    unit_cost = float(recipe_unit_cost)
                    line_cost = float(row["quantity"]) * unit_cost

        if line_cost is None:
            complete = False
        else:
            total_cost += line_cost

        outputs.append(
            MenuComponentOutput(
                id=int(row["id"]),
                component_type=component_type,
                item_id=int(row["item_id"]) if row["item_id"] is not None else None,
                item_name=row["item_name"],
                unit_id=int(row["unit_id"]) if row["unit_id"] is not None else None,
                unit_name=row["unit_name"],
                recipe_id=int(row["recipe_id"]) if row["recipe_id"] is not None else None,
                recipe_name=row["recipe_name"],
                recipe_output_unit_name=row["recipe_output_unit_name"],
                quantity=float(row["quantity"]),
                unit_cost=unit_cost,
                line_cost=line_cost,
                cost_complete=line_cost is not None,
            )
        )

    return outputs, total_cost if complete else None, complete


def open_menu_alert_exists(
    connection: sqlite3.Connection,
    menu_item_option_id: int,
) -> bool:
    row = connection.execute(
        """
        SELECT id
        FROM menu_cost_alerts
        WHERE menu_item_option_id = ? AND status = 'OPEN'
        LIMIT 1
        """,
        (menu_item_option_id,),
    ).fetchone()
    return row is not None


def option_to_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
    base_price: int,
) -> MenuItemOptionOutput:
    components, current_cost, complete = calculate_menu_option(
        connection,
        int(row["id"]),
    )
    reference = row["reference_cost"]
    change_percent = None
    if (
        complete
        and current_cost is not None
        and reference is not None
        and float(reference) > 0
    ):
        change_percent = (
            (current_cost - float(reference)) / float(reference) * 100
        )

    sale_price = int(base_price) + int(row["extra_price"])
    cost_percent = (
        current_cost / sale_price * 100
        if complete and current_cost is not None and sale_price > 0
        else None
    )

    return MenuItemOptionOutput(
        id=int(row["id"]),
        service_option_id=int(row["service_option_id"]),
        service_option_name=row["service_option_name"],
        extra_price=int(row["extra_price"]),
        sale_price=sale_price,
        alert_threshold_percent=float(row["alert_threshold_percent"]),
        display_order=int(row["display_order"]),
        is_active=bool(row["is_active"]),
        reference_cost=float(reference) if reference is not None else None,
        current_cost=current_cost,
        change_percent=change_percent,
        cost_percent=cost_percent,
        cost_complete=complete,
        has_open_alert=open_menu_alert_exists(connection, int(row["id"])),
        components=components,
    )


def select_options(
    connection: sqlite3.Connection,
    menu_item_id: int,
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT
            mio.id,
            mio.service_option_id,
            so.name AS service_option_name,
            mio.extra_price,
            mio.alert_threshold_percent,
            mio.reference_cost,
            mio.display_order,
            mio.is_active
        FROM menu_item_options AS mio
        JOIN service_options AS so ON so.id = mio.service_option_id
        WHERE mio.menu_item_id = ?
        ORDER BY mio.display_order ASC, so.display_order ASC, so.name ASC
        """,
        (menu_item_id,),
    ).fetchall()


def menu_item_to_output(
    connection: sqlite3.Connection,
    row: sqlite3.Row,
) -> MenuItemOutput:
    options = [
        option_to_output(connection, option, int(row["base_price"]))
        for option in select_options(connection, int(row["id"]))
    ]
    return MenuItemOutput(
        id=int(row["id"]),
        name=row["name"],
        menu_group_id=int(row["menu_group_id"]),
        menu_group_name=row["menu_group_name"],
        sale_unit_id=int(row["sale_unit_id"]),
        sale_unit_name=row["sale_unit_name"],
        base_price=int(row["base_price"]),
        display_order=int(row["display_order"]),
        is_active=bool(row["is_active"]),
        note=row["note"],
        ingredients=calculate_menu_ingredients(
            connection,
            int(row["id"]),
        )[0],
        options=options,
    )


def ingredient_signature_from_rows(rows: list[sqlite3.Row]) -> tuple:
    return tuple(
        (
            int(row["item_id"]),
            int(row["unit_id"]),
            round(float(row["quantity"]), 9),
        )
        for row in rows
    )


def ingredient_signature_from_payload(
    ingredients: list[MenuIngredientInput],
) -> tuple:
    return tuple(
        (
            ingredient.item_id,
            ingredient.unit_id,
            round(float(ingredient.quantity), 9),
        )
        for ingredient in ingredients
    )


def component_signature_from_rows(rows: list[sqlite3.Row]) -> tuple:
    return tuple(
        (
            row["component_type"],
            int(row["item_id"]) if row["item_id"] is not None else None,
            int(row["unit_id"]) if row["unit_id"] is not None else None,
            int(row["recipe_id"]) if row["recipe_id"] is not None else None,
            round(float(row["quantity"]), 9),
        )
        for row in rows
    )


def component_signature_from_payload(
    components: list[MenuComponentInput],
) -> tuple:
    return tuple(
        (
            component.component_type.strip().upper(),
            component.item_id,
            component.unit_id,
            component.recipe_id,
            round(float(component.quantity), 9),
        )
        for component in components
    )


def set_menu_reference_to_current(
    connection: sqlite3.Connection,
    menu_item_option_id: int,
) -> float | None:
    _, current_cost, complete = calculate_menu_option(
        connection,
        menu_item_option_id,
    )
    if not complete or current_cost is None:
        connection.execute(
            "UPDATE menu_item_options SET reference_cost = NULL WHERE id = ?",
            (menu_item_option_id,),
        )
        connection.execute(
            """
            UPDATE menu_cost_alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
            WHERE menu_item_option_id = ? AND status = 'OPEN'
            """,
            (menu_item_option_id,),
        )
        return None

    connection.execute(
        "UPDATE menu_item_options SET reference_cost = ? WHERE id = ?",
        (current_cost, menu_item_option_id),
    )
    connection.execute(
        """
        UPDATE menu_cost_alerts
        SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
        WHERE menu_item_option_id = ? AND status = 'OPEN'
        """,
        (menu_item_option_id,),
    )
    return current_cost


def refresh_menu_option_alert(
    connection: sqlite3.Connection,
    menu_item_option_id: int,
) -> None:
    row = connection.execute(
        """
        SELECT id, reference_cost, alert_threshold_percent, is_active
        FROM menu_item_options
        WHERE id = ?
        """,
        (menu_item_option_id,),
    ).fetchone()
    if row is None:
        return

    if not bool(row["is_active"]):
        connection.execute(
            """
            UPDATE menu_cost_alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
            WHERE menu_item_option_id = ? AND status = 'OPEN'
            """,
            (menu_item_option_id,),
        )
        return

    _, current_cost, complete = calculate_menu_option(
        connection,
        menu_item_option_id,
    )
    if not complete or current_cost is None:
        return

    reference = row["reference_cost"]
    if reference is None or float(reference) <= 0:
        connection.execute(
            "UPDATE menu_item_options SET reference_cost = ? WHERE id = ?",
            (current_cost, menu_item_option_id),
        )
        return

    reference_value = float(reference)
    change_percent = (current_cost - reference_value) / reference_value * 100
    threshold = float(row["alert_threshold_percent"])
    open_alert = connection.execute(
        """
        SELECT id
        FROM menu_cost_alerts
        WHERE menu_item_option_id = ? AND status = 'OPEN'
        LIMIT 1
        """,
        (menu_item_option_id,),
    ).fetchone()

    if change_percent >= threshold:
        if open_alert is None:
            connection.execute(
                """
                INSERT INTO menu_cost_alerts (
                    menu_item_option_id,
                    reference_cost,
                    current_cost,
                    change_percent,
                    status,
                    detected_at
                )
                VALUES (?, ?, ?, ?, 'OPEN', CURRENT_TIMESTAMP)
                """,
                (
                    menu_item_option_id,
                    reference_value,
                    current_cost,
                    change_percent,
                ),
            )
        else:
            connection.execute(
                """
                UPDATE menu_cost_alerts
                SET current_cost = ?, change_percent = ?
                WHERE id = ?
                """,
                (current_cost, change_percent, int(open_alert["id"])),
            )
    elif open_alert is not None:
        connection.execute(
            """
            UPDATE menu_cost_alerts
            SET status = 'RESOLVED', resolved_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(open_alert["id"]),),
        )


def refresh_menu_cost_alerts_for_items(
    item_ids: list[int] | None = None,
) -> None:
    with connect() as connection:
        if item_ids:
            placeholders = ",".join("?" for _ in item_ids)
            params = tuple(item_ids) + tuple(item_ids) + tuple(item_ids)
            rows = connection.execute(
                f"""
                SELECT DISTINCT mio.id
                FROM menu_item_options AS mio
                LEFT JOIN menu_item_ingredients AS mii
                  ON mii.menu_item_id = mio.menu_item_id
                LEFT JOIN menu_item_components AS mic
                  ON mic.menu_item_option_id = mio.id
                LEFT JOIN recipe_items AS ri
                  ON mic.component_type = 'RECIPE'
                 AND ri.recipe_id = mic.recipe_id
                WHERE
                    mii.item_id IN ({placeholders})
                    OR
                    (
                        mic.component_type = 'ITEM'
                        AND mic.item_id IN ({placeholders})
                    )
                    OR
                    (
                        mic.component_type = 'RECIPE'
                        AND ri.item_id IN ({placeholders})
                    )
                """,
                params,
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT id FROM menu_item_options"
            ).fetchall()

        for row in rows:
            refresh_menu_option_alert(connection, int(row["id"]))
        connection.commit()


def refresh_menu_cost_alerts_for_recipes(recipe_ids: list[int]) -> None:
    if not recipe_ids:
        return
    with connect() as connection:
        placeholders = ",".join("?" for _ in recipe_ids)
        rows = connection.execute(
            f"""
            SELECT DISTINCT menu_item_option_id AS id
            FROM menu_item_components
            WHERE component_type = 'RECIPE'
              AND recipe_id IN ({placeholders})
            """,
            tuple(recipe_ids),
        ).fetchall()
        for row in rows:
            refresh_menu_option_alert(connection, int(row["id"]))
        connection.commit()


def replace_menu_item_ingredients(
    connection: sqlite3.Connection,
    menu_item_id: int,
    ingredients: list[MenuIngredientInput],
) -> None:
    connection.execute(
        "DELETE FROM menu_item_ingredients WHERE menu_item_id = ?",
        (menu_item_id,),
    )
    for ingredient in ingredients:
        connection.execute(
            """
            INSERT INTO menu_item_ingredients (
                menu_item_id,
                item_id,
                unit_id,
                quantity
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                menu_item_id,
                ingredient.item_id,
                ingredient.unit_id,
                ingredient.quantity,
            ),
        )


def replace_option_components(
    connection: sqlite3.Connection,
    menu_item_option_id: int,
    components: list[MenuComponentInput],
) -> None:
    connection.execute(
        "DELETE FROM menu_item_components WHERE menu_item_option_id = ?",
        (menu_item_option_id,),
    )
    for component in components:
        component_type = component.component_type.strip().upper()
        connection.execute(
            """
            INSERT INTO menu_item_components (
                menu_item_option_id,
                component_type,
                item_id,
                unit_id,
                recipe_id,
                quantity
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                menu_item_option_id,
                component_type,
                component.item_id if component_type == "ITEM" else None,
                component.unit_id if component_type == "ITEM" else None,
                component.recipe_id if component_type == "RECIPE" else None,
                component.quantity,
            ),
        )


def replace_menu_item_options(
    connection: sqlite3.Connection,
    menu_item_id: int,
    options: list[MenuItemOptionInput],
) -> None:
    existing_rows = connection.execute(
        """
        SELECT id, service_option_id
        FROM menu_item_options
        WHERE menu_item_id = ?
        """,
        (menu_item_id,),
    ).fetchall()
    existing_by_service = {
        int(row["service_option_id"]): int(row["id"]) for row in existing_rows
    }
    requested_services = {option.service_option_id for option in options}

    for service_option_id, option_id in existing_by_service.items():
        if service_option_id not in requested_services:
            connection.execute(
                "DELETE FROM menu_item_options WHERE id = ?",
                (option_id,),
            )

    for option in options:
        option_id = existing_by_service.get(option.service_option_id)
        definition_changed = True

        if option_id is None:
            cursor = connection.execute(
                """
                INSERT INTO menu_item_options (
                    menu_item_id,
                    service_option_id,
                    extra_price,
                    alert_threshold_percent,
                    reference_cost,
                    display_order,
                    is_active
                )
                VALUES (?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    menu_item_id,
                    option.service_option_id,
                    option.extra_price,
                    option.alert_threshold_percent,
                    option.display_order,
                    int(option.is_active),
                ),
            )
            option_id = int(cursor.lastrowid)
        else:
            current_components = select_components(connection, option_id)
            definition_changed = (
                component_signature_from_rows(current_components)
                != component_signature_from_payload(option.components)
            )
            connection.execute(
                """
                UPDATE menu_item_options
                SET extra_price = ?,
                    alert_threshold_percent = ?,
                    display_order = ?,
                    is_active = ?
                WHERE id = ?
                """,
                (
                    option.extra_price,
                    option.alert_threshold_percent,
                    option.display_order,
                    int(option.is_active),
                    option_id,
                ),
            )

        replace_option_components(connection, option_id, option.components)

        if option_id not in existing_by_service.values() or definition_changed:
            set_menu_reference_to_current(connection, option_id)
        else:
            refresh_menu_option_alert(connection, option_id)


@router.get("/groups", response_model=list[MenuGroupOutput])
def list_menu_groups() -> list[MenuGroupOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, name, display_order, is_active, note
            FROM menu_groups
            ORDER BY is_active DESC, display_order ASC, name ASC
            """
        ).fetchall()
        return [
            MenuGroupOutput(
                id=int(row["id"]),
                name=row["name"],
                display_order=int(row["display_order"]),
                is_active=bool(row["is_active"]),
                note=row["note"],
            )
            for row in rows
        ]


@router.post(
    "/groups",
    response_model=MenuGroupOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_menu_group(payload: MenuGroupInput) -> MenuGroupOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên nhóm thực đơn không được để trống.",
        )

    with connect() as connection:
        ensure_group_name_unique(connection, name)
        cursor = connection.execute(
            """
            INSERT INTO menu_groups (
                name, display_order, is_active, note
            )
            VALUES (?, ?, ?, ?)
            """,
            (
                name,
                payload.display_order,
                int(payload.is_active),
                clean_optional(payload.note),
            ),
        )
        connection.commit()
        group_id = int(cursor.lastrowid)

    backup_database(reason="menu-group-created")
    return MenuGroupOutput(
        id=group_id,
        name=name,
        display_order=payload.display_order,
        is_active=payload.is_active,
        note=clean_optional(payload.note),
    )


@router.put("/groups/{group_id}", response_model=MenuGroupOutput)
def update_menu_group(
    group_id: int,
    payload: MenuGroupInput,
) -> MenuGroupOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên nhóm thực đơn không được để trống.",
        )

    with connect() as connection:
        ensure_group(connection, group_id)
        ensure_group_name_unique(connection, name, exclude_id=group_id)
        connection.execute(
            """
            UPDATE menu_groups
            SET name = ?, display_order = ?, is_active = ?, note = ?
            WHERE id = ?
            """,
            (
                name,
                payload.display_order,
                int(payload.is_active),
                clean_optional(payload.note),
                group_id,
            ),
        )
        connection.commit()

    backup_database(reason="menu-group-updated")
    return MenuGroupOutput(
        id=group_id,
        name=name,
        display_order=payload.display_order,
        is_active=payload.is_active,
        note=clean_optional(payload.note),
    )


@router.get("/items", response_model=list[MenuItemOutput])
def list_menu_items() -> list[MenuItemOutput]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT
                mi.id,
                mi.name,
                mi.menu_group_id,
                mg.name AS menu_group_name,
                mi.sale_unit_id,
                u.name AS sale_unit_name,
                mi.base_price,
                mi.display_order,
                mi.is_active,
                mi.note
            FROM menu_items AS mi
            JOIN menu_groups AS mg ON mg.id = mi.menu_group_id
            JOIN units AS u ON u.id = mi.sale_unit_id
            ORDER BY
                mi.is_active DESC,
                mg.display_order ASC,
                mi.display_order ASC,
                mi.name ASC
            """
        ).fetchall()
        return [menu_item_to_output(connection, row) for row in rows]


@router.get("/items/{menu_item_id}", response_model=MenuItemOutput)
def get_menu_item(menu_item_id: int) -> MenuItemOutput:
    with connect() as connection:
        row = select_menu_item(connection, menu_item_id)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy món.",
            )
        return menu_item_to_output(connection, row)


@router.post(
    "/items",
    response_model=MenuItemOutput,
    status_code=status.HTTP_201_CREATED,
)
def create_menu_item(payload: MenuItemInput) -> MenuItemOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên món không được để trống.",
        )

    with connect() as connection:
        ensure_group(connection, payload.menu_group_id)
        ensure_unit(connection, payload.sale_unit_id)
        ensure_menu_item_name_unique(
            connection,
            menu_group_id=payload.menu_group_id,
            name=name,
        )
        validate_ingredients(connection, payload.ingredients)
        validate_options(connection, payload.options)

        cursor = connection.execute(
            """
            INSERT INTO menu_items (
                name,
                menu_group_id,
                sale_unit_id,
                base_price,
                display_order,
                is_active,
                note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                payload.menu_group_id,
                payload.sale_unit_id,
                payload.base_price,
                payload.display_order,
                int(payload.is_active),
                clean_optional(payload.note),
            ),
        )
        menu_item_id = int(cursor.lastrowid)
        replace_menu_item_ingredients(connection, menu_item_id, payload.ingredients)
        replace_menu_item_options(connection, menu_item_id, payload.options)
        connection.commit()

        row = select_menu_item(connection, menu_item_id)
        assert row is not None
        output = menu_item_to_output(connection, row)

    backup_database(reason="menu-item-created")
    return output


@router.put("/items/{menu_item_id}", response_model=MenuItemOutput)
def update_menu_item(
    menu_item_id: int,
    payload: MenuItemInput,
) -> MenuItemOutput:
    name = clean_name(payload.name)
    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên món không được để trống.",
        )

    with connect() as connection:
        existing = select_menu_item(connection, menu_item_id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy món.",
            )

        ensure_group(connection, payload.menu_group_id)
        ensure_unit(connection, payload.sale_unit_id)
        ensure_menu_item_name_unique(
            connection,
            menu_group_id=payload.menu_group_id,
            name=name,
            exclude_id=menu_item_id,
        )
        validate_ingredients(connection, payload.ingredients)
        validate_options(connection, payload.options)
        ingredients_changed = (
            ingredient_signature_from_rows(
                select_menu_ingredients(connection, menu_item_id)
            )
            != ingredient_signature_from_payload(payload.ingredients)
        )

        connection.execute(
            """
            UPDATE menu_items
            SET name = ?,
                menu_group_id = ?,
                sale_unit_id = ?,
                base_price = ?,
                display_order = ?,
                is_active = ?,
                note = ?
            WHERE id = ?
            """,
            (
                name,
                payload.menu_group_id,
                payload.sale_unit_id,
                payload.base_price,
                payload.display_order,
                int(payload.is_active),
                clean_optional(payload.note),
                menu_item_id,
            ),
        )
        replace_menu_item_ingredients(connection, menu_item_id, payload.ingredients)
        replace_menu_item_options(connection, menu_item_id, payload.options)
        if ingredients_changed:
            for option in select_options(connection, menu_item_id):
                set_menu_reference_to_current(connection, int(option["id"]))
        connection.commit()

        row = select_menu_item(connection, menu_item_id)
        assert row is not None
        output = menu_item_to_output(connection, row)

    backup_database(reason="menu-item-updated")
    return output


@router.get("/alerts", response_model=list[MenuCostAlertOutput])
def list_menu_cost_alerts(
    include_resolved: bool = False,
) -> list[MenuCostAlertOutput]:
    refresh_menu_cost_alerts_for_items()

    with connect() as connection:
        where = "" if include_resolved else "WHERE a.status = 'OPEN'"
        rows = connection.execute(
            f"""
            SELECT
                a.id,
                a.menu_item_option_id,
                mi.id AS menu_item_id,
                mi.name AS menu_item_name,
                mio.service_option_id,
                so.name AS service_option_name,
                a.reference_cost,
                a.current_cost,
                a.change_percent,
                mio.alert_threshold_percent,
                a.status,
                a.detected_at,
                a.resolved_at
            FROM menu_cost_alerts AS a
            JOIN menu_item_options AS mio
              ON mio.id = a.menu_item_option_id
            JOIN menu_items AS mi ON mi.id = mio.menu_item_id
            JOIN service_options AS so
              ON so.id = mio.service_option_id
            {where}
            ORDER BY
                CASE WHEN a.status = 'OPEN' THEN 0 ELSE 1 END,
                a.detected_at DESC,
                a.id DESC
            """
        ).fetchall()

        return [
            MenuCostAlertOutput(
                id=int(row["id"]),
                menu_item_option_id=int(row["menu_item_option_id"]),
                menu_item_id=int(row["menu_item_id"]),
                menu_item_name=row["menu_item_name"],
                service_option_id=int(row["service_option_id"]),
                service_option_name=row["service_option_name"],
                reference_cost=float(row["reference_cost"]),
                current_cost=float(row["current_cost"]),
                change_percent=float(row["change_percent"]),
                alert_threshold_percent=float(row["alert_threshold_percent"]),
                status=row["status"],
                detected_at=row["detected_at"],
                resolved_at=row["resolved_at"],
            )
            for row in rows
        ]


@router.post(
    "/item-options/{menu_item_option_id}/accept-current-cost",
    response_model=MenuItemOptionOutput,
)
def accept_menu_option_current_cost(
    menu_item_option_id: int,
) -> MenuItemOptionOutput:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT
                mio.id,
                mio.menu_item_id,
                mio.service_option_id,
                so.name AS service_option_name,
                mio.extra_price,
                mio.alert_threshold_percent,
                mio.reference_cost,
                mio.display_order,
                mio.is_active,
                mi.base_price
            FROM menu_item_options AS mio
            JOIN service_options AS so
              ON so.id = mio.service_option_id
            JOIN menu_items AS mi ON mi.id = mio.menu_item_id
            WHERE mio.id = ?
            """,
            (menu_item_option_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Không tìm thấy định lượng món.",
            )

        _, current_cost, complete = calculate_menu_option(
            connection,
            menu_item_option_id,
        )
        if not complete or current_cost is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Chưa đủ giá nguyên liệu để cập nhật mốc Cost món.",
            )

        set_menu_reference_to_current(connection, menu_item_option_id)
        connection.commit()

        updated = connection.execute(
            """
            SELECT
                mio.id,
                mio.service_option_id,
                so.name AS service_option_name,
                mio.extra_price,
                mio.alert_threshold_percent,
                mio.reference_cost,
                mio.display_order,
                mio.is_active
            FROM menu_item_options AS mio
            JOIN service_options AS so
              ON so.id = mio.service_option_id
            WHERE mio.id = ?
            """,
            (menu_item_option_id,),
        ).fetchone()
        assert updated is not None
        output = option_to_output(
            connection,
            updated,
            int(row["base_price"]),
        )

    backup_database(reason="menu-cost-reference-updated")
    return output
