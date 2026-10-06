import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from .backup import backup_database
from .backup_routes import router as backup_router
from .database import init_db
from .cost_recipes import router as cost_router
from .consumption import router as consumption_router
from .fund_accounts import router as fund_accounts_router
from .fund_transaction_categories import router as fund_transaction_categories_router
from .fund_transactions import router as fund_transactions_router
from .item_groups import router as item_groups_router
from .items import router as items_router
from .menu import router as menu_router
from .inventory import router as inventory_router
from .purchase_receipts import router as purchase_receipts_router
from .sales import router as sales_router
from .suppliers import router as suppliers_router
from .units import router as units_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    backup_database(reason="startup")
    yield


app = FastAPI(
    title="OC11 API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def disable_frontend_cache(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.include_router(item_groups_router)
app.include_router(cost_router)
app.include_router(consumption_router)
app.include_router(fund_accounts_router)
app.include_router(fund_transaction_categories_router)
app.include_router(fund_transactions_router)
app.include_router(items_router)
app.include_router(menu_router)
app.include_router(inventory_router)
app.include_router(purchase_receipts_router)
app.include_router(sales_router)
app.include_router(suppliers_router)
app.include_router(units_router)
app.include_router(backup_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/runtime")
def runtime_info() -> dict[str, str | int]:
    return {
        "app": "OC11",
        "pid": os.getpid(),
        "runtime_token": os.getenv("OC11_RUNTIME_TOKEN", ""),
        "executable": os.getenv("OC11_EXECUTABLE", ""),
        "build_version": os.getenv("OC11_BUILD_VERSION", ""),
    }


static_dir = os.getenv("OC11_STATIC_DIR")
if static_dir:
    static_path = Path(static_dir)
    if static_path.exists():
        app.mount(
            "/",
            StaticFiles(directory=static_path, html=True),
            name="manager-web",
        )
