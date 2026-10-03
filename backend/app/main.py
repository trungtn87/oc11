from contextlib import asynccontextmanager

from fastapi import FastAPI

from .database import init_db
from .item_groups import router as item_groups_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="OC11 API",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(item_groups_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
