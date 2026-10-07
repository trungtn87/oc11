import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import App from "./App";
import PosApp from "./PosApp";
import "./styles.css";

const mode = new URLSearchParams(window.location.search).get("mode");
const RootApp = mode === "pos" ? PosApp : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
