import { Component, type ClipboardEvent, type ErrorInfo, type ReactNode } from "react";

type MarkdownEditorBoundaryProps = {
  markdown: string;
  resetKey: string;
  children: ReactNode;
  onChange: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onError: (message: string) => void;
};

type MarkdownEditorBoundaryState = { error: string | null };

export class MarkdownEditorBoundary extends Component<MarkdownEditorBoundaryProps, MarkdownEditorBoundaryState> {
  state: MarkdownEditorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): MarkdownEditorBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error instanceof Error ? error.message : String(error));
  }

  componentDidUpdate(previousProps: MarkdownEditorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <textarea
          className="note-main-editor note-main-editor-raw note-editor-fallback"
          value={this.props.markdown}
          onPaste={this.props.onPaste}
          onChange={(event) => this.props.onChange(event.target.value)}
        />
      );
    }
    return this.props.children;
  }
}
