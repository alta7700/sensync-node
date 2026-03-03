import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClientRuntime } from '@sensync2/client-runtime';
import { ElectronBridgeTransport } from './electronTransport.ts';
const runtimeSingleton = new ClientRuntime(new ElectronBridgeTransport());
function useRuntimeSnapshot() {
    const [rev, setRev] = useState(0);
    useEffect(() => runtimeSingleton.onUpdate(() => setRev((r) => r + 1)), []);
    useEffect(() => {
        void runtimeSingleton.connect();
        return () => {
            void runtimeSingleton.disconnect();
        };
    }, []);
    return { snapshot: runtimeSingleton.getSnapshot(), rev };
}
function ControlsWidget({ widget }) {
    return (_jsxs("section", { style: panelStyle, children: [_jsx("h3", { style: titleStyle, children: widget.title }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8 }, children: widget.controls.map((control) => (_jsx("button", { type: "button", onClick: () => void runtimeSingleton.sendCommand(control.commandType, control.payload), style: {
                        border: '1px solid var(--border)',
                        background: 'linear-gradient(180deg, #1f2937 0%, #161b22 100%)',
                        color: 'var(--text)',
                        padding: '8px 10px',
                        borderRadius: 10,
                        cursor: 'pointer',
                    }, children: control.label }, control.id))) })] }));
}
function StatusWidget({ widget, flags }) {
    return (_jsxs("section", { style: panelStyle, children: [_jsx("h3", { style: titleStyle, children: widget.title }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }, children: widget.flagKeys.map((key) => {
                    const value = flags[key];
                    const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? '—');
                    const color = text.includes('connected') || text === 'true' ? 'var(--ok)' : text.includes('failed') ? 'var(--bad)' : 'var(--muted)';
                    return (_jsxs("div", { style: { border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: '#11161d' }, children: [_jsx("div", { style: { fontSize: 12, color: 'var(--muted)' }, children: key }), _jsx("div", { style: { fontWeight: 700, color }, children: text })] }, key));
                }) })] }));
}
function TelemetryWidget({ widget, telemetry }) {
    return (_jsxs("section", { style: panelStyle, children: [_jsx("h3", { style: titleStyle, children: widget.title }), _jsxs("div", { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 8 }, children: ["Dropped total: ", telemetry?.dropped ?? 0] }), _jsx("div", { style: { display: 'grid', gap: 6 }, children: (telemetry?.queues ?? []).map((q) => (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '220px repeat(5, minmax(70px, auto))', gap: 8, fontSize: 12 }, children: [_jsx("span", { children: q.pluginId }), _jsxs("span", { children: ["c:", q.controlDepth] }), _jsxs("span", { children: ["d:", q.dataDepth] }), _jsxs("span", { children: ["drop:", q.dropped] }), _jsxs("span", { children: ["coal:", q.coalesced] }), _jsxs("span", { children: [q.avgHandlerMs.toFixed(2), "ms"] })] }, q.pluginId))) })] }));
}
function LineChartWidget({ widget }) {
    const canvasRef = useRef(null);
    const streamIds = widget.streamIds;
    const timeWindowMs = widget.timeWindowMs ?? 10_000;
    useEffect(() => {
        let raf = 0;
        const colors = ['#58a6ff', '#3fb950', '#f85149', '#d29922', '#a371f7', '#ffa657'];
        const draw = () => {
            const canvas = canvasRef.current;
            if (!canvas) {
                raf = requestAnimationFrame(draw);
                return;
            }
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== Math.floor(rect.width * devicePixelRatio) || canvas.height !== Math.floor(rect.height * devicePixelRatio)) {
                canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
                canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                raf = requestAnimationFrame(draw);
                return;
            }
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = '#0f141b';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#253041';
            ctx.lineWidth = 1;
            for (let i = 1; i < 4; i += 1) {
                const y = (h / 4) * i;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }
            const nowMs = Date.now();
            const minT = nowMs - timeWindowMs;
            const maxT = nowMs;
            let yMin = -1.5;
            let yMax = 1.5;
            const windows = streamIds.map((streamId) => runtimeSingleton.getVisibleWindow(streamId, timeWindowMs));
            for (const win of windows) {
                for (let i = 0; i < win.length; i += 1) {
                    const v = win.y[i];
                    if (v < yMin)
                        yMin = v;
                    if (v > yMax)
                        yMax = v;
                }
            }
            if (Math.abs(yMax - yMin) < 1e-6) {
                yMin -= 1;
                yMax += 1;
            }
            const scaleX = (t) => ((t - minT) / (maxT - minT)) * w;
            const scaleY = (v) => h - ((v - yMin) / (yMax - yMin)) * h;
            windows.forEach((win, idx) => {
                if (win.length === 0)
                    return;
                ctx.strokeStyle = colors[idx % colors.length] ?? '#58a6ff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                for (let i = 0; i < win.length; i += 1) {
                    const x = scaleX(win.x[i]);
                    const y = scaleY(win.y[i]);
                    if (i === 0)
                        ctx.moveTo(x, y);
                    else
                        ctx.lineTo(x, y);
                }
                ctx.stroke();
            });
            raf = requestAnimationFrame(draw);
        };
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [streamIds, timeWindowMs]);
    return (_jsxs("section", { style: panelStyle, children: [_jsx("h3", { style: titleStyle, children: widget.title }), _jsx("div", { style: { position: 'relative' }, children: _jsx("canvas", { ref: canvasRef, style: { width: '100%', height: widget.height ?? 260, display: 'block', borderRadius: 10, border: '1px solid var(--border)' } }) }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)' }, children: streamIds.map((id) => _jsx("span", { children: id }, id)) })] }));
}
function renderWidget(widget, flags, telemetry) {
    if (widget.kind === 'controls')
        return _jsx(ControlsWidget, { widget: widget }, widget.id);
    if (widget.kind === 'status')
        return _jsx(StatusWidget, { widget: widget, flags: flags }, widget.id);
    if (widget.kind === 'line-chart')
        return _jsx(LineChartWidget, { widget: widget }, widget.id);
    return _jsx(TelemetryWidget, { widget: widget, telemetry: telemetry }, widget.id);
}
const panelStyle = {
    background: 'linear-gradient(180deg, rgba(22,27,34,0.92) 0%, rgba(13,17,23,0.92) 100%)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 12,
    boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
};
const titleStyle = { margin: '0 0 10px', fontSize: 14, letterSpacing: 0.3 };
export function App() {
    const { snapshot, rev } = useRuntimeSnapshot();
    const page = useMemo(() => snapshot.schema?.pages[0], [snapshot.schema, rev]);
    const widgets = useMemo(() => {
        if (!snapshot.schema || !page)
            return [];
        const byId = new Map(snapshot.schema.widgets.map((w) => [w.id, w]));
        return page.widgetIds.map((id) => byId.get(id)).filter(Boolean);
    }, [snapshot.schema, page, rev]);
    return (_jsxs("div", { style: { minHeight: '100%', padding: 16, display: 'grid', gap: 12, alignContent: 'start' }, children: [_jsxs("header", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, children: [_jsxs("div", { children: [_jsx("h1", { style: { margin: 0, fontSize: 22 }, children: "Sensync2" }), _jsx("div", { style: { color: 'var(--muted)', fontSize: 12 }, children: snapshot.connected ? `connected${snapshot.sessionId ? ` • ${snapshot.sessionId}` : ''}` : 'disconnected' })] }), snapshot.flags.lastError ? (_jsx("div", { style: { color: 'var(--bad)', fontSize: 12, maxWidth: 420, textAlign: 'right' }, children: String(snapshot.flags.lastError) })) : null] }), !snapshot.schema ? (_jsxs("section", { style: panelStyle, children: [_jsx("h3", { style: titleStyle, children: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0441\u0445\u0435\u043C\u044B UI" }), _jsx("div", { style: { color: 'var(--muted)', fontSize: 13 }, children: "Renderer \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D, \u043E\u0436\u0438\u0434\u0430\u0435\u043C `ui.init` \u043E\u0442 `ui-gateway`." })] })) : (widgets.map((widget) => renderWidget(widget, snapshot.flags, snapshot.telemetry)))] }));
}
