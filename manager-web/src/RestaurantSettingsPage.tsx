import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Space,
  Switch,
  Typography
} from "antd";

import {
  createRestaurantArea,
  createRestaurantTablesBulk,
  getRestaurantAreas,
  getRestaurantTables,
  updateRestaurantArea,
  updateRestaurantTable
} from "./api";
import type {
  RestaurantArea,
  RestaurantAreaInput,
  RestaurantTable,
  RestaurantTableInput
} from "./types";
import "./RestaurantTablesSettings.css";

const { Title, Text } = Typography;

type DragState = {
  tableId: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultTablePosition(index: number) {
  const columns = 5;
  return {
    x: 4 + (index % columns) * 19,
    y: 6 + Math.floor(index / columns) * 19
  };
}

function visiblePosition(table: RestaurantTable, index: number) {
  if (table.pos_x === 0 && table.pos_y === 0) {
    return defaultTablePosition(index);
  }
  return {
    x: clamp(table.pos_x, 0, 84),
    y: clamp(table.pos_y, 0, 84)
  };
}

function tablePayload(
  table: RestaurantTable,
  overrides: Partial<RestaurantTableInput> = {}
): RestaurantTableInput {
  return {
    area_id: table.area_id,
    name: table.name,
    seats: table.seats,
    display_order: table.display_order,
    pos_x: table.pos_x,
    pos_y: table.pos_y,
    is_active: table.is_active,
    ...overrides
  };
}

export function RestaurantTablesSettings() {
  const [areas, setAreas] = useState<RestaurantArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [areaOpen, setAreaOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<RestaurantArea | null>(null);
  const [bulkCount, setBulkCount] = useState(1);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [autoArranging, setAutoArranging] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [areaForm] = Form.useForm<RestaurantAreaInput>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  async function load() {
    setLoading(true);
    try {
      const [areaRows, tableRows] = await Promise.all([
        getRestaurantAreas(),
        getRestaurantTables()
      ]);
      setAreas(areaRows);
      setTables(tableRows);
      setSelectedAreaId((current) => {
        if (current !== null && areaRows.some((area) => area.id === current)) {
          return current;
        }
        return (
          areaRows.find((area) => area.is_active)?.id ??
          areaRows[0]?.id ??
          null
        );
      });
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tải được sơ đồ bàn."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const selectedArea =
    areas.find((area) => area.id === selectedAreaId) ?? null;

  const areaTables = useMemo(
    () =>
      tables
        .filter((table) => table.area_id === selectedAreaId)
        .sort(
          (left, right) =>
            left.display_order - right.display_order || left.id - right.id
        ),
    [tables, selectedAreaId]
  );

  function openArea(area?: RestaurantArea) {
    setEditingArea(area ?? null);
    areaForm.setFieldsValue(
      area
        ? {
            name: area.name,
            display_order: area.display_order,
            is_active: area.is_active
          }
        : {
            name: "",
            display_order: areas.length,
            is_active: true
          }
    );
    setAreaOpen(true);
  }

  async function saveArea() {
    const values = await areaForm.validateFields();
    try {
      const saved = editingArea
        ? await updateRestaurantArea(editingArea.id, values)
        : await createRestaurantArea(values);

      messageApi.success("Đã lưu khu vực.");
      setAreaOpen(false);
      setSelectedAreaId(saved.id);
      await load();
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được khu vực."
      );
    }
  }

  async function addTables() {
    if (!selectedAreaId) {
      messageApi.warning("Chọn khu vực trước.");
      return;
    }

    const quantity = Math.max(1, Math.min(30, Math.round(bulkCount || 1)));
    setBulkCreating(true);
    try {
      const created = await createRestaurantTablesBulk(selectedAreaId, quantity);
      setTables((current) => [...current, ...created]);
      messageApi.success(`Đã tạo ${created.length} bàn.`);
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không tạo được bàn."
      );
    } finally {
      setBulkCreating(false);
    }
  }

  async function autoArrange() {
    if (!areaTables.length) return;

    setAutoArranging(true);
    const optimistic = areaTables.map((table, index) => ({
      ...table,
      pos_x: defaultTablePosition(index).x,
      pos_y: defaultTablePosition(index).y
    }));

    setTables((current) =>
      current.map(
        (table) => optimistic.find((row) => row.id === table.id) ?? table
      )
    );

    try {
      const saved = await Promise.all(
        optimistic.map((table) =>
          updateRestaurantTable(
            table.id,
            tablePayload(table, {
              pos_x: table.pos_x,
              pos_y: table.pos_y
            })
          )
        )
      );
      setTables((current) =>
        current.map((table) => saved.find((row) => row.id === table.id) ?? table)
      );
      messageApi.success("Đã xếp bàn tự động.");
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được vị trí bàn."
      );
      await load();
    } finally {
      setAutoArranging(false);
    }
  }

  function startRename(table: RestaurantTable) {
    setRenamingId(table.id);
    setRenameValue(table.name);
  }

  async function saveRename(table: RestaurantTable) {
    const name = renameValue.trim();
    setRenamingId(null);

    if (!name || name === table.name) {
      return;
    }

    setTables((current) =>
      current.map((row) => (row.id === table.id ? { ...row, name } : row))
    );

    try {
      const saved = await updateRestaurantTable(
        table.id,
        tablePayload(table, { name })
      );
      setTables((current) =>
        current.map((row) => (row.id === saved.id ? saved : row))
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không đổi được tên bàn."
      );
      await load();
    }
  }

  async function toggleTable(table: RestaurantTable) {
    const nextActive = !table.is_active;
    try {
      const saved = await updateRestaurantTable(
        table.id,
        tablePayload(table, { is_active: nextActive })
      );
      setTables((current) =>
        current.map((row) => (row.id === saved.id ? saved : row))
      );
      messageApi.success(
        nextActive ? "Đã bật lại bàn." : "Đã ngừng sử dụng bàn."
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error
          ? error.message
          : "Không đổi được trạng thái bàn."
      );
    }
  }

  function beginDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    table: RestaurantTable,
    index: number
  ) {
    if (renamingId === table.id) return;

    const position = visiblePosition(table, index);
    dragRef.current = {
      tableId: table.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      currentX: position.x,
      currentY: position.y,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dx = ((event.clientX - drag.startClientX) / rect.width) * 100;
    const dy = ((event.clientY - drag.startClientY) / rect.height) * 100;
    const nextX = clamp(drag.startX + dx, 0, 84);
    const nextY = clamp(drag.startY + dy, 0, 84);

    drag.currentX = nextX;
    drag.currentY = nextY;
    drag.moved =
      drag.moved ||
      Math.abs(event.clientX - drag.startClientX) > 2 ||
      Math.abs(event.clientY - drag.startClientY) > 2;

    setTables((current) =>
      current.map((table) =>
        table.id === drag.tableId
          ? { ...table, pos_x: nextX, pos_y: nextY }
          : table
      )
    );
  }

  async function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (!drag.moved) return;

    const table = tables.find((row) => row.id === drag.tableId);
    if (!table) return;

    try {
      const saved = await updateRestaurantTable(
        table.id,
        tablePayload(table, {
          pos_x: drag.currentX,
          pos_y: drag.currentY
        })
      );
      setTables((current) =>
        current.map((row) => (row.id === saved.id ? saved : row))
      );
    } catch (error) {
      messageApi.error(
        error instanceof Error ? error.message : "Không lưu được vị trí bàn."
      );
      await load();
    }
  }

  return (
    <>
      {contextHolder}

      <div className="page-heading">
        <div>
          <Title level={3}>Khu vực & bàn</Title>
          <Text type="secondary">
            Tạo bàn theo từng khu vực, kéo thả đúng vị trí thực tế và sửa tên trực tiếp trên sơ đồ.
          </Text>
        </div>
      </div>

      <Card className="table-layout-card" loading={loading}>
        <div className="table-layout-toolbar">
          <div className="table-area-tabs">
            {areas.map((area) => (
              <Button
                key={area.id}
                type={selectedAreaId === area.id ? "primary" : "default"}
                onClick={() => setSelectedAreaId(area.id)}
              >
                {area.name}
                {!area.is_active ? " (ngừng dùng)" : ""}
              </Button>
            ))}
            <Button onClick={() => openArea()}>+ Khu vực</Button>
            {selectedArea && (
              <Button onClick={() => openArea(selectedArea)}>
                Sửa khu vực
              </Button>
            )}
          </div>

          <div className="table-create-tools">
            <span>Thêm nhanh</span>
            <InputNumber<number>
              min={1}
              max={30}
              precision={0}
              value={bulkCount}
              onChange={(value) => setBulkCount(Number(value ?? 1))}
            />
            <span>bàn</span>
            <Button
              type="primary"
              loading={bulkCreating}
              disabled={!selectedArea || !selectedArea.is_active}
              onClick={() => void addTables()}
            >
              Tạo bàn
            </Button>
            <Button
              loading={autoArranging}
              disabled={!areaTables.length}
              onClick={() => void autoArrange()}
            >
              Xếp tự động
            </Button>
          </div>
        </div>

        <div className="table-layout-hint">
          Kéo bàn để đổi vị trí. Bấm đúp vào tên hoặc nút ✎ để đổi tên. Vị trí được lưu và POS hiển thị theo đúng sơ đồ này.
        </div>

        <div ref={canvasRef} className="table-layout-canvas">
          {areaTables.map((table, index) => {
            const position = visiblePosition(table, index);
            const isRenaming = renamingId === table.id;

            return (
              <div
                key={table.id}
                className={`layout-table ${table.is_active ? "" : "inactive"}`}
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`
                }}
                onPointerDown={(event) => beginDrag(event, table, index)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => void endDrag(event)}
                onPointerCancel={(event) => void endDrag(event)}
              >
                <button
                  type="button"
                  className="layout-table-toggle"
                  title={table.is_active ? "Ngừng sử dụng" : "Bật lại bàn"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void toggleTable(table)}
                >
                  {table.is_active ? "●" : "○"}
                </button>

                <div className="layout-table-icon">▣</div>

                {isRenaming ? (
                  <Input
                    size="small"
                    autoFocus
                    value={renameValue}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => void saveRename(table)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        setRenamingId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="layout-table-name"
                    title="Bấm đúp để sửa tên"
                    onPointerDown={(event) => event.stopPropagation()}
                    onDoubleClick={() => startRename(table)}
                  >
                    {table.name}
                  </button>
                )}

                {!isRenaming && (
                  <button
                    type="button"
                    className="layout-table-edit"
                    title="Sửa tên bàn"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => startRename(table)}
                  >
                    ✎
                  </button>
                )}

                {!table.is_active && (
                  <small className="layout-table-status">Ngừng dùng</small>
                )}
              </div>
            );
          })}

          {!loading && selectedArea && !areaTables.length && (
            <div className="table-layout-empty">
              Khu vực này chưa có bàn. Nhập số lượng phía trên rồi bấm “Tạo bàn”.
            </div>
          )}

          {!loading && !selectedArea && (
            <div className="table-layout-empty">
              Chưa có khu vực. Tạo khu vực trước.
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={areaOpen}
        title={editingArea ? "Sửa khu vực" : "Thêm khu vực"}
        okText="Lưu"
        cancelText="Hủy"
        onOk={() => void saveArea()}
        onCancel={() => setAreaOpen(false)}
      >
        <Form form={areaForm} layout="vertical">
          <Form.Item
            name="name"
            label="Tên khu vực"
            rules={[{ required: true, message: "Nhập tên khu vực." }]}
          >
            <Input autoFocus placeholder="VD: Tầng 1, Sân" />
          </Form.Item>
          <Form.Item name="display_order" label="Thứ tự">
            <InputNumber style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="is_active" label="Đang sử dụng" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

