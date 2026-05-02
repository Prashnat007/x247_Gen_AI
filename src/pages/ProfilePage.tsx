import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import {
  User as UserIcon, Mail, Calendar as CalendarIcon, MapPin, Briefcase,
  Edit3, Save, X, Camera, Shield, Bell, Globe, Lock, Key, Trash2,
  Award, Brain, Zap, Database, Activity, TrendingUp, Clock, CheckCircle2,
  Settings as SettingsIcon, LogOut, ChevronRight, Sparkles, Star,
  Github, Twitter, Linkedin, ExternalLink, Copy, Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ProfilePageProps {
  user?: any;
  onSignOut?: () => void;
}

const ACHIEVEMENTS = [
  { id: 'first-capture', icon: Database, color: '#00d4ff', title: 'First Capture', desc: 'Saved your first memory', earned: true },
  { id: 'week-streak', icon: Zap, color: '#f59e0b', title: '7-Day Streak', desc: 'Captured 7 days in a row', earned: true },
  { id: 'agent-master', icon: Brain, color: '#a78bfa', title: 'Agent Master', desc: 'Used all 7 agents', earned: true },
  { id: 'knowledge-100', icon: Award, color: '#10b981', title: '100 Memories', desc: 'Saved 100+ items', earned: false, progress: 68 },
  { id: 'recall-pro', icon: Sparkles, color: '#ec4899', title: 'Recall Pro', desc: '50 successful recalls', earned: false, progress: 42 },
  { id: 'sharer', icon: Star, color: '#3b82f6', title: 'Power User', desc: 'Connect 5 integrations', earned: false, progress: 20 },
];

const ProfilePage: React.FC<ProfilePageProps> = ({ user, onSignOut }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'edit' | 'security' | 'preferences' | 'data'>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [stats, setStats] = useState({ memories: 0, tasks: 0, workflows: 0, streak: 7 });

  const [formData, setFormData] = useState({
    displayName: user?.displayName || 'Recall User',
    email: user?.email || 'user@recall.ai',
    bio: 'Building a second brain with AI agents. Curious mind, voracious learner.',
    role: 'Knowledge Worker',
    location: 'APAC',
    website: '',
    twitter: '',
    github: '',
    linkedin: '',
  });

  useEffect(() => {
    Promise.all([
      fetch('/stats').then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch('/memories?limit=200').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/tasks?limit=200').then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/workflows?limit=50').then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([_s, m, t, w]) => {
      setStats({
        memories: Array.isArray(m) ? m.length : 0,
        tasks: Array.isArray(t) ? t.length : 0,
        workflows: Array.isArray(w) ? w.length : 0,
        streak: 7,
      });
    });
  }, []);

  const copyField = (field: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  };

  const initials = (formData.displayName || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const memberSince = user?.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'April 2026';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 0 28px', minHeight: 'calc(100vh - 5rem)' }}>

      {/* HERO HEADER */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(34,211,238,0.18))', border: '1px solid rgba(59,130,246,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 28px rgba(59,130,246,0.2)' }}>
              <UserIcon size={24} color="#3b82f6" />
            </div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 20, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#3b82f6', letterSpacing: '0.5px' }}>PROFILE · MEMBER SINCE {memberSince.toUpperCase()}</span>
              </div>
              <h2 style={{ fontSize: 'clamp(22px,3.5vw,30px)', fontWeight: 900, color: 'var(--text-1)', margin: 0, letterSpacing: '-0.6px', lineHeight: 1.05 }}>
                Profile <span style={{ color: '#3b82f6' }}>✦</span>
              </h2>
              <p style={{ color: 'var(--text-3)', fontSize: 13.5, margin: '4px 0 0' }}>
                Manage your identity, preferences and data across the Recall X247 brain
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => navigate('/settings')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <SettingsIcon size={13} /> Settings
            </button>
            <button onClick={onSignOut} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, color: '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>

        {/* STATS STRIP */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {[
            { icon: Database, color: '#00d4ff', label: 'Memories', value: stats.memories, sub: 'in your brain' },
            { icon: CheckCircle2, color: '#10b981', label: 'Tasks Completed', value: stats.tasks, sub: 'across projects' },
            { icon: Activity, color: '#a78bfa', label: 'Agent Workflows', value: stats.workflows, sub: 'orchestrated' },
            { icon: TrendingUp, color: '#f59e0b', label: 'Day Streak', value: stats.streak, sub: 'consecutive days' },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 13 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${stat.color}15`, border: `1px solid ${stat.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <stat.icon size={18} color={stat.color} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>{stat.label}</div>
                <div style={{ color: 'var(--text-1)', fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{stat.value}</div>
                <div style={{ color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>{stat.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* BODY: 2 columns */}
      <div className="profile-body-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr', gap: 16, alignItems: 'start' }}>

        {/* LEFT: Profile card + Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 12, alignSelf: 'start' }}>
          {/* Profile Card */}
          <div style={{ padding: '20px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 60, background: 'linear-gradient(135deg, rgba(59,130,246,0.18), rgba(34,211,238,0.08))', borderRadius: '14px 14px 0 0' }} />
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 10 }}>
              {user?.photoURL ? (
                <img src={user.photoURL} alt={formData.displayName} style={{ width: 84, height: 84, borderRadius: '50%', border: '3px solid var(--surface)', boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }} />
              ) : (
                <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#1e3a8a)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 30, fontWeight: 800, border: '3px solid var(--surface)', boxShadow: '0 6px 20px rgba(0,0,0,0.3)' }}>
                  {initials}
                </div>
              )}
              <button title="Change avatar" style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: 'var(--surface-2)', border: '2px solid var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>
                <Camera size={11} />
              </button>
            </div>
            <h3 style={{ margin: '6px 0 2px', color: 'var(--text-1)', fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' }}>{formData.displayName}</h3>
            <p style={{ margin: '0 0 4px', color: 'var(--text-3)', fontSize: 12 }}>{formData.email}</p>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 12, marginTop: 6 }}>
              <Sparkles size={10} color="#a78bfa" />
              <span style={{ color: '#a78bfa', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px' }}>PRO MEMBER</span>
            </div>
            <p style={{ margin: '12px 0 0', color: 'var(--text-2)', fontSize: 12, lineHeight: 1.5, textAlign: 'left' }}>{formData.bio}</p>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left' }}>
              {[
                { icon: Briefcase, label: formData.role },
                { icon: MapPin, label: formData.location },
                { icon: CalendarIcon, label: `Member since ${memberSince}` },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 11.5 }}>
                  <item.icon size={11} /> {item.label}
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {([
              { key: 'overview', label: 'Overview', icon: UserIcon },
              { key: 'edit', label: 'Edit Profile', icon: Edit3 },
              { key: 'security', label: 'Security', icon: Shield },
              { key: 'preferences', label: 'Preferences', icon: Bell },
              { key: 'data', label: 'Data & Privacy', icon: Lock },
            ] as const).map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 12px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: activeTab === tab.key ? 'var(--primary-bg)' : 'transparent', color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-2)', fontSize: 12.5, fontWeight: activeTab === tab.key ? 700 : 500, transition: 'all 0.15s', textAlign: 'left' }}>
                <tab.icon size={13} /> {tab.label}
                {activeTab === tab.key && <ChevronRight size={11} style={{ marginLeft: 'auto' }} />}
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: Tab content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {activeTab === 'overview' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Achievements */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Award size={15} color="#f59e0b" />
                    <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 14, fontWeight: 800 }}>Achievements</h3>
                  </div>
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{ACHIEVEMENTS.filter(a => a.earned).length} / {ACHIEVEMENTS.length} unlocked</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {ACHIEVEMENTS.map(ach => (
                    <div key={ach.id} style={{ padding: '11px 12px', background: ach.earned ? `${ach.color}08` : 'var(--surface-2)', border: `1px solid ${ach.earned ? ach.color + '30' : 'var(--border)'}`, borderRadius: 11, opacity: ach.earned ? 1 : 0.7, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: `${ach.color}18`, border: `1px solid ${ach.color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <ach.icon size={15} color={ach.color} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: 'var(--text-1)', fontSize: 12, fontWeight: 700 }}>{ach.title}</div>
                          <div style={{ color: 'var(--text-3)', fontSize: 10.5 }}>{ach.desc}</div>
                        </div>
                        {ach.earned && <CheckCircle2 size={14} color="#10b981" style={{ flexShrink: 0 }} />}
                      </div>
                      {!ach.earned && ach.progress !== undefined && (
                        <div>
                          <div style={{ height: 4, background: 'var(--surface-3)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${ach.progress}%`, background: ach.color, borderRadius: 2 }} />
                          </div>
                          <div style={{ marginTop: 4, color: 'var(--text-3)', fontSize: 10 }}>{ach.progress}% complete</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Account info quick view */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
                <h3 style={{ margin: '0 0 12px', color: 'var(--text-1)', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserIcon size={14} color="#3b82f6" /> Account Information
                </h3>
                {[
                  { label: 'Display name', value: formData.displayName, copy: false },
                  { label: 'Email address', value: formData.email, copy: true, key: 'email' },
                  { label: 'User ID', value: user?.uid || 'demo-user-x247', copy: true, key: 'uid' },
                  { label: 'Plan', value: 'Pro · Annual', copy: false },
                  { label: 'Member since', value: memberSince, copy: false },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-3)', fontSize: 12, fontWeight: 600 }}>{row.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: 'var(--text-1)', fontSize: 12.5, fontWeight: 500, fontFamily: row.key === 'uid' ? "'JetBrains Mono',monospace" : 'inherit' }}>{row.value}</span>
                      {row.copy && (
                        <button onClick={() => copyField(row.key!, String(row.value))} style={{ padding: 4, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: copiedField === row.key ? '#10b981' : 'var(--text-3)', display: 'flex', alignItems: 'center' }}>
                          {copiedField === row.key ? <Check size={11} /> : <Copy size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Connected social */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px' }}>
                <h3 style={{ margin: '0 0 12px', color: 'var(--text-1)', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Globe size={14} color="#06b6d4" /> Linked Accounts
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { icon: Github, label: 'GitHub', color: '#fff', connected: false },
                    { icon: Twitter, label: 'X (Twitter)', color: '#1da1f2', connected: false },
                    { icon: Linkedin, label: 'LinkedIn', color: '#0a66c2', connected: false },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10 }}>
                      <s.icon size={14} color={s.color} />
                      <span style={{ flex: 1, color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600 }}>{s.label}</span>
                      <button onClick={() => navigate('/integrations')} style={{ padding: '5px 12px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 8, color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {s.connected ? 'Connected' : 'Connect'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'edit' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ margin: 0, color: 'var(--text-1)', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Edit3 size={14} color="var(--primary)" /> Edit Profile
                </h3>
                {isEditing ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setIsEditing(false)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><X size={11} /> Cancel</button>
                    <button onClick={() => setIsEditing(false)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'linear-gradient(135deg,#3b82f6,#2563eb)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}><Save size={11} /> Save</button>
                  </div>
                ) : (
                  <button onClick={() => setIsEditing(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'var(--primary-bg)', border: '1px solid var(--primary-border)', borderRadius: 8, color: 'var(--primary)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}><Edit3 size={11} /> Edit</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { key: 'displayName', label: 'Display name', icon: UserIcon, full: false },
                  { key: 'email', label: 'Email', icon: Mail, full: false },
                  { key: 'role', label: 'Role / Title', icon: Briefcase, full: false },
                  { key: 'location', label: 'Location', icon: MapPin, full: false },
                  { key: 'bio', label: 'Bio', icon: Edit3, full: true },
                  { key: 'website', label: 'Website', icon: Globe, full: false },
                  { key: 'twitter', label: 'X / Twitter handle', icon: Twitter, full: false },
                ].map(f => (
                  <div key={f.key} style={{ gridColumn: f.full ? '1 / -1' : 'auto' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-3)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
                      <f.icon size={11} /> {f.label}
                    </label>
                    {f.key === 'bio' ? (
                      <AutoGrowTextarea value={(formData as any)[f.key]} onChange={e => setFormData({ ...formData, [f.key]: e.target.value })} disabled={!isEditing} rows={3}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', opacity: isEditing ? 1 : 0.7 }} />
                    ) : (
                      <input value={(formData as any)[f.key]} onChange={e => setFormData({ ...formData, [f.key]: e.target.value })} disabled={!isEditing}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', opacity: isEditing ? 1 : 0.7 }} />
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'security' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ margin: '0 0 14px', color: 'var(--text-1)', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={14} color="#10b981" /> Security
                </h3>
                {[
                  { title: 'Password', desc: 'Change your password regularly to keep your brain secure', action: 'Change password', icon: Key, color: '#3b82f6' },
                  { title: 'Two-factor authentication', desc: 'Add an extra layer of security to your account', action: 'Enable 2FA', icon: Shield, color: '#10b981', badge: 'Recommended' },
                  { title: 'Active sessions', desc: 'View and revoke devices logged into your account', action: 'Manage sessions', icon: Activity, color: '#a78bfa' },
                  { title: 'API keys', desc: 'Generate keys for programmatic access', action: 'Manage keys', icon: Key, color: '#f59e0b' },
                ].map(item => (
                  <div key={item.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: `${item.color}15`, border: `1px solid ${item.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <item.icon size={16} color={item.color} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700 }}>{item.title}</span>
                        {item.badge && <span style={{ padding: '2px 7px', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, color: '#f59e0b', fontSize: 9.5, fontWeight: 700 }}>{item.badge}</span>}
                      </div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11.5, marginTop: 2 }}>{item.desc}</div>
                    </div>
                    <button style={{ padding: '7px 13px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-1)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{item.action}</button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'preferences' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
              <h3 style={{ margin: '0 0 14px', color: 'var(--text-1)', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Bell size={14} color="#a78bfa" /> Notification Preferences
              </h3>
              {[
                { title: 'Daily briefing email', desc: 'Get your morning AI briefing in your inbox', enabled: true },
                { title: 'Weekly insight digest', desc: 'Summary of what you learned this week', enabled: true },
                { title: 'Capture confirmations', desc: 'Notify when AI agents finish processing a capture', enabled: false },
                { title: 'Task reminders', desc: 'Alert before due dates and time-sensitive tasks', enabled: true },
                { title: 'New feature announcements', desc: 'Stay updated on what\'s new in Recall X247', enabled: false },
              ].map(p => (
                <div key={p.title} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text-1)', fontSize: 13, fontWeight: 700 }}>{p.title}</div>
                    <div style={{ color: 'var(--text-3)', fontSize: 11.5, marginTop: 2 }}>{p.desc}</div>
                  </div>
                  <button style={{ width: 40, height: 22, borderRadius: 11, background: p.enabled ? '#10b981' : 'var(--surface-3)', border: 'none', position: 'relative', cursor: 'pointer', transition: 'background 0.2s' }}>
                    <div style={{ position: 'absolute', top: 2, left: p.enabled ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                  </button>
                </div>
              ))}
            </motion.div>
          )}

          {activeTab === 'data' && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ margin: '0 0 12px', color: 'var(--text-1)', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Lock size={14} color="#06b6d4" /> Data & Privacy
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button style={{ padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Database size={16} color="#3b82f6" />
                    <div style={{ flex: 1 }}>
                      <div>Export all data</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 2 }}>Download all memories, tasks and workflows as JSON</div>
                    </div>
                    <ChevronRight size={13} color="var(--text-3)" />
                  </button>
                  <button style={{ padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 11, color: 'var(--text-1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <ExternalLink size={16} color="#10b981" />
                    <div style={{ flex: 1 }}>
                      <div>Privacy policy</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 2 }}>How we handle your data</div>
                    </div>
                    <ChevronRight size={13} color="var(--text-3)" />
                  </button>
                </div>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 14, padding: '18px 20px' }}>
                <h3 style={{ margin: '0 0 8px', color: '#ef4444', fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Trash2 size={14} /> Danger Zone
                </h3>
                <p style={{ margin: '0 0 12px', color: 'var(--text-2)', fontSize: 12, lineHeight: 1.5 }}>
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <button style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 9, color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Delete account
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
