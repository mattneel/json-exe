import { monaco } from "./monaco/setup";
import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";

// Dev-only hook so devtools (and the e2e smoke test) can inspect models/markers.
if (import.meta.env.DEV) {
  (globalThis as { jsonexeMonaco?: typeof monaco }).jsonexeMonaco = monaco;
}

const root = document.getElementById("root");
if (root) render(() => <App />, root);
