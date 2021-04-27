import * as vscode from "vscode";
import { PreviewBackend } from './previewBackend';
import ExtensionResource from "../resource/extensionResource";
import Uri from '../util/uri';

export default class PreviewView {

    static async create(context: vscode.ExtensionContext): Promise<PreviewView> {
        const resource = new ExtensionResource(context);
        const panel = vscode.window.createWebviewPanel(
            'zenn-editor.preview',
            'Zenn Editor Preview',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(context.extensionPath)],
            }
        );
        context.subscriptions.push(panel);

        return new PreviewView(panel, resource);
    }


    private readonly webviewPanel: vscode.WebviewPanel;

    private readonly previewBackends: Map<string, PreviewBackend> = new Map();

    private currentBackend: PreviewBackend | undefined;

    private readonly resource: ExtensionResource;

    private constructor(webviewPanel: vscode.WebviewPanel, resource: ExtensionResource) {
        this.resource = resource;
        this.webviewPanel = webviewPanel;
        this.webviewPanel.webview.onDidReceiveMessage(this.receiveWebviewMessage);
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                this.handleDidChangeActiveTextEditor(editor)
            }
        });
    }

    private receiveWebviewMessage(message: any): void {
        switch (message.command) {
            case 'open-link':
                vscode.env.openExternal(vscode.Uri.parse(message.link));
                break;
            default:
                console.log('unhandled message', message);
        }
    }

    private static resolveDocuemntRelativePath(documentUri: Uri, cwdUri: Uri): string {
        return documentUri.relativePathFrom(cwdUri).replace(/\.(md|md\.git)$/, "");
    }

    private webviewHtml(previewBackend: PreviewBackend): string {
        return `
            <html>
                <head>
                    <script src="${this.resource.uri('dist', 'webview.js')}"></script>
                </head>
                <body>
                    <div>
                        <iframe id="zenn-proxy" src="${previewBackend.entrypointUrl()}" width="100%" height="100%" seamless frameborder=0></iframe>
                    </div>
                </body>
            </html>
        `;
    }

    private async handleDidChangeActiveTextEditor(textEditor: vscode.TextEditor): Promise<void> {
        if (textEditor.document.languageId === 'markdown') {
            const document = Uri.of(textEditor.document.uri);
            const workspace = document.workspaceDirectory();
            if (workspace) {
                if (!(this.currentBackend && this.currentBackend.isProvide(document))) {
                    await this.open(document);
                }
                const documentRelativePath = PreviewView.resolveDocuemntRelativePath(document, workspace);
                this.webviewPanel.webview.postMessage({ command: 'change_path', relativePath: documentRelativePath });
            }
        }
    }

    public async open(uri: Uri): Promise<void> {
        const workspace = uri.workspaceDirectory();
        if (workspace) {
            const key = workspace.fsPath();
            const backend = this.previewBackends.get(key);
            if (backend) {
                this.currentBackend = backend;
                this.webviewPanel.webview.html = this.webviewHtml(backend);
            } else {
                const newBackend = await PreviewBackend.start(uri, this.resource);
                this.previewBackends.set(key, newBackend);
                this.webviewPanel.onDidDispose(() => newBackend.stop());
                this.currentBackend = newBackend;
                this.webviewPanel.webview.html = this.webviewHtml(newBackend);
            }
        }
    }

    public onDidClose(listener: () => void): void {
        this.webviewPanel.onDidDispose(listener);
    }

    public reveal(): void {
        this.webviewPanel.reveal();
    }
}
