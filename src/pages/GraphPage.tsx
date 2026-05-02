import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Network, MousePointer2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Memory } from '../lib/types';

interface GraphNode { id: string; label: string; x: number; y: number; r: number; color: string; type: 'center' | 'domain' | 'memory'; domainId?: string; vx: number; vy: number; fixed?: boolean; memory?: Memory; }

const COLORS = ['#00d4ff', '#8b5cf6', '#f472b6', '#10b981', '#f59e0b', '#ef4444'];

interface KnowledgeGraphViewProps { embedded?: boolean }
const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({ embedded = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<any>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const animRef = useRef<number>(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const hoveredId = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/memories?limit=40').then(r => r.ok ? r.json() : []),
      fetch('/stats').then(r => r.ok ? r.json() : null),
    ]).then(([m, s]) => { setMemories(Array.isArray(m) ? m : []); setStats(s); });
  }, []);

  const buildGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || memories.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W;
    canvas.height = H;

    const domains = [...new Set(memories.map(m => m.domain || 'General'))];
    const nodes: GraphNode[] = [
      { id: 'center', label: 'Recall X247', x: W / 2, y: H / 2, r: 28, color: '#00d4ff', type: 'center', vx: 0, vy: 0, fixed: true },
    ];

    domains.forEach((d, i) => {
      const angle = (i / domains.length) * Math.PI * 2 - Math.PI / 2;
      const dist = Math.min(W, H) * 0.28;
      nodes.push({ id: `domain:${d}`, label: d, x: W / 2 + Math.cos(angle) * dist, y: H / 2 + Math.sin(angle) * dist, r: 18, color: COLORS[i % COLORS.length], type: 'domain', vx: 0, vy: 0 });
    });

    memories.slice(0, 25).forEach((m, i) => {
      const domIdx = domains.indexOf(m.domain || 'General');
      const parent = nodes.find(n => n.id === `domain:${m.domain || 'General'}`);
      const angle = (i / Math.min(memories.length, 25)) * Math.PI * 2;
      const dist = 65;
      const px = parent ? parent.x : W / 2;
      const py = parent ? parent.y : H / 2;
      nodes.push({ id: `mem:${m.id}`, label: m.title.slice(0, 18), x: px + Math.cos(angle) * dist + (Math.random() - 0.5) * 20, y: py + Math.sin(angle) * dist + (Math.random() - 0.5) * 20, r: 8, color: COLORS[domIdx % COLORS.length], type: 'memory', domainId: `domain:${m.domain || 'General'}`, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, memory: m });
    });

    nodesRef.current = nodes;
    let frame = 0;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      frame++;

      const nds = nodesRef.current;
      nds.forEach(n => {
        if (n.fixed) return;
        const parent = n.domainId ? nds.find(p => p.id === n.domainId) : nds[0];
        if (parent) {
          const dx = parent.x - n.x; const dy = parent.y - n.y;
          const d2 = Math.sqrt(dx * dx + dy * dy) || 1;
          const target = n.type === 'domain' ? Math.min(W, H) * 0.28 : 70;
          const force = (d2 - target) * 0.002;
          n.vx += (dx / d2) * force; n.vy += (dy / d2) * force;
        }
        nds.forEach(o => {
          if (o.id === n.id) return;
          const dx = n.x - o.x; const dy = n.y - o.y;
          const d2 = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d2 < 60) { n.vx += (dx / d2) * 0.3; n.vy += (dy / d2) * 0.3; }
        });
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(n.r + 10, Math.min(W - n.r - 10, n.x));
        n.y = Math.max(n.r + 10, Math.min(H - n.r - 10, n.y));
      });

      // Draw edges
      nds.forEach(n => {
        if (n.type === 'center') return;
        const parent = n.domainId ? nds.find(p => p.id === n.domainId) : nds[0];
        if (!parent) return;
        const isHovered = n.id === hoveredId.current || parent.id === hoveredId.current;
        ctx.beginPath();
        ctx.strokeStyle = isHovered ? `${n.color}70` : (n.type === 'domain' ? `${n.color}40` : `${n.color}18`);
        ctx.lineWidth = isHovered ? 2 : (n.type === 'domain' ? 1.5 : 0.8);
        ctx.moveTo(parent.x, parent.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      });

      // Draw nodes
      nds.forEach(n => {
        const isHov = n.id === hoveredId.current;
        const isSel = selectedNode?.id === n.id;
        const pulse = n.type === 'center' ? Math.sin(frame * 0.04) * 3 + n.r : n.r;
        const rr = isHov ? pulse * 1.3 : pulse;

        // Glow
        const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr * 2.5);
        grad.addColorStop(0, `${n.color}${isHov ? '50' : '25'}`);
        grad.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(n.x, n.y, rr * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();

        // Node fill
        ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? `${n.color}45` : `${n.color}22`; ctx.fill();
        ctx.strokeStyle = n.color; ctx.lineWidth = isHov || isSel ? 2.5 : (n.type === 'center' ? 2 : 1.5);
        ctx.stroke();

        // Label
        if (n.type !== 'memory' || isHov) {
          ctx.fillStyle = isHov ? n.color : (n.type === 'center' ? '#00d4ff' : 'var(--text-3, #9ca3af)');
          ctx.font = `${n.type === 'center' ? '700 11px' : isHov ? '600 9px' : '500 9px'} 'Poppins', sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(n.type === 'center' ? '' : n.label, n.x, n.y + rr + 12);
        }

        // Center text
        if (n.type === 'center') {
          ctx.fillStyle = '#ffffff';
          ctx.font = "600 9px 'Poppins', sans-serif";
          ctx.textAlign = 'center';
          ctx.fillText(n.label, n.x, n.y + 3);
        }
      });

      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [memories, selectedNode]);

  useEffect(() => {
    const cleanup = buildGraph();
    return cleanup;
  }, [buildGraph]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    let found: GraphNode | null = null;
    for (const n of nodesRef.current) {
      const dx = mx - n.x; const dy = my - n.y;
      if (dx * dx + dy * dy < (n.r + 6) * (n.r + 6)) { found = n; break; }
    }
    hoveredId.current = found ? found.id : null;
    if (found) {
      setTooltip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8, node: found });
      canvas.style.cursor = 'pointer';
    } else {
      setTooltip(null);
      canvas.style.cursor = 'default';
    }
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    for (const n of nodesRef.current) {
      const dx = mx - n.x; const dy = my - n.y;
      if (dx * dx + dy * dy < (n.r + 6) * (n.r + 6)) {
        setSelectedNode(prev => prev?.id === n.id ? null : n);
        return;
      }
    }
    setSelectedNode(null);
  }, []);

  const handleMouseLeave = () => { hoveredId.current = null; setTooltip(null); };

  const domains = stats?.knowledge_domains ?? [];

  return (
    <div style={{ color: 'var(--text-1)' }}>
      {!embedded && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Network size={17} color="#8b5cf6" />
            </div>
            <div>
              <h1 style={{ color: 'var(--text-1)', fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.4px' }}>Mind Graph</h1>
              <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>Interactive map of your knowledge connections — hover to explore</p>
            </div>
          </div>
        </motion.div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 250px', gap: 14 }}>
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}
          ref={containerRef}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', height: 520, position: 'relative' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }}
            onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} onClick={handleClick} />

          {memories.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <Network size={40} color="var(--border-2)" />
              <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>No memories to graph yet</p>
            </div>
          )}

          {/* Tooltip */}
          <AnimatePresence>
            {tooltip && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', left: tooltip.x, top: tooltip.y, pointerEvents: 'none', zIndex: 10 }}>
                <div style={{ background: 'var(--surface)', border: `1px solid ${tooltip.node.color}40`, borderRadius: 10, padding: '8px 12px', boxShadow: `0 8px 24px rgba(0,0,0,0.35), 0 0 0 1px ${tooltip.node.color}20`, maxWidth: 200 }}>
                  <div style={{ color: tooltip.node.color, fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>
                    {tooltip.node.type === 'center' ? 'HUB' : tooltip.node.type.toUpperCase()}
                  </div>
                  <div style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
                    {tooltip.node.memory?.title ?? tooltip.node.label}
                  </div>
                  {tooltip.node.memory?.domain && (
                    <div style={{ color: 'var(--text-3)', fontSize: 10, marginTop: 4 }}>Domain: {tooltip.node.memory.domain}</div>
                  )}
                  {tooltip.node.type === 'memory' && (
                    <div style={{ color: 'var(--text-3)', fontSize: 9.5, marginTop: 3 }}>Click to view details</div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom stats bar */}
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {memories.length > 0 && (
              <div style={{ padding: '5px 11px', background: 'rgba(5,5,15,0.75)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, color: 'var(--text-3)', fontSize: 10, backdropFilter: 'blur(8px)' }}>
                {memories.length} memories · {[...new Set(memories.map(m => m.domain))].length} domains
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: 'rgba(5,5,15,0.75)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, backdropFilter: 'blur(8px)' }}>
              <MousePointer2 size={10} color="var(--text-3)" />
              <span style={{ color: 'var(--text-3)', fontSize: 10 }}>Hover to explore · Click to select</span>
            </div>
          </div>
        </motion.div>

        {/* Right panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Selected node info */}
          <AnimatePresence>
            {selectedNode && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                style={{ background: 'var(--surface)', border: `1px solid ${selectedNode.color}30`, borderRadius: 14, padding: '14px 16px', boxShadow: `0 0 20px ${selectedNode.color}10` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedNode.color, boxShadow: `0 0 6px ${selectedNode.color}` }} />
                  <span style={{ color: selectedNode.color, fontSize: 9.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>SELECTED</span>
                </div>
                <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700, marginBottom: 4, lineHeight: 1.3 }}>
                  {selectedNode.memory?.title ?? selectedNode.label}
                </div>
                {selectedNode.memory && (
                  <>
                    <div style={{ color: 'var(--text-3)', fontSize: 11, marginBottom: 3 }}>{selectedNode.memory.domain}</div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: 1.5, marginBottom: 6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{selectedNode.memory.summary}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {selectedNode.memory.tags.slice(0, 3).map(t => (
                        <span key={t} style={{ padding: '2px 7px', background: `${selectedNode.color}10`, border: `1px solid ${selectedNode.color}20`, borderRadius: 20, color: selectedNode.color, fontSize: 9, fontWeight: 700 }}>#{t}</span>
                      ))}
                    </div>
                  </>
                )}
                {selectedNode.type === 'domain' && (
                  <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
                    {memories.filter(m => (m.domain || 'General') === selectedNode.label).length} memories in this domain
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 12.5, marginBottom: 12 }}>Domain Nodes</div>
            {domains.length > 0 ? domains.map((d: any, i: number) => (
              <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS[i % COLORS.length], boxShadow: `0 0 6px ${COLORS[i % COLORS.length]}`, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-2)', fontSize: 12, flex: 1 }}>{d.name}</span>
                <span style={{ color: COLORS[i % COLORS.length], fontSize: 11, fontWeight: 700 }}>{d.value}</span>
              </div>
            )) : <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>Capture memories to see graph</p>}
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 12.5, marginBottom: 10 }}>Legend</div>
            {[
              { label: 'Central Hub', color: '#00d4ff', size: 12 },
              { label: 'Domain Node', color: '#8b5cf6', size: 9 },
              { label: 'Memory Node', color: '#6b7280', size: 6 },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ width: l.size, height: l.size, borderRadius: '50%', background: l.color, boxShadow: `0 0 6px ${l.color}80`, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{l.label}</span>
              </div>
            ))}
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ color: 'var(--text-1)', fontWeight: 700, fontSize: 12.5, marginBottom: 8 }}>Graph Stats</div>
            {[
              { label: 'Total Nodes', value: memories.length + ([...new Set(memories.map(m => m.domain))].length || 0) + 1 },
              { label: 'Total Edges', value: memories.length + ([...new Set(memories.map(m => m.domain))].length || 0) },
              { label: 'Domains', value: [...new Set(memories.map(m => m.domain))].length || 0 },
              { label: 'Memories', value: memories.length },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{s.label}</span>
                <span style={{ color: 'var(--text-1)', fontSize: 11, fontWeight: 700 }}>{s.value}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeGraphView;
