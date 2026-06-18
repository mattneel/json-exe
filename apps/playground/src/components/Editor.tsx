import { onCleanup, onMount } from "solid-js";
import { monaco } from "../monaco/setup";

export interface EditorProps {
  model: monaco.editor.ITextModel;
  onReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
}

/** A Solid wrapper that mounts a Monaco editor bound to a pre-created model. */
export function Editor(props: EditorProps) {
  let container!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    editor = monaco.editor.create(container, {
      model: props.model,
      theme: "jsonexe-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      tabSize: 2,
      renderWhitespace: "none",
      fixedOverflowWidgets: true,
    });
    props.onReady?.(editor);
  });

  onCleanup(() => editor?.dispose());

  return <div class="editor" ref={container} />;
}
