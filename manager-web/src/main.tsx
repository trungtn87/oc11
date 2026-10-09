import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import App from "./App";
import PosApp from "./PosApp";
import "./styles.css";

const mode = new URLSearchParams(window.location.search).get("mode");
// Manager compact-control rules must never shrink POS buttons (including portal modals).
document.body.classList.toggle("oc11-pos-mode", mode === "pos");
const RootApp = mode === "pos" ? PosApp : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
