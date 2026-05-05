import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight, ArrowLeft, Eye, EyeOff, Mail, Lock, User as UserIcon,
  ShieldCheck, Sparkles, Loader2,
} from 'lucide-react';
import keyholeImg from '@/src/assets/login-keyhole.webp';
import x247Logo from '@/src/assets/x247-logo.webp';
import auraImg from '@/src/assets/login-aura.webp';

type AuthFns = {
  onGoogleSignIn: () => Promise<any>;
  onEmailSignIn: (email: string, password: string) => Promise<any>;
  onEmailSignUp: (email: string, password: string, name: string) => Promise<any>;
  onResetPassword: (email: string) => Promise<void>;
  onAnonymousSignIn: () => Promise<any>;
  navigate: (path: string) => void;
  initialMode?: 'sign-in' | 'sign-up';
};

const friendlyError = (code: string): string => ({
  'auth/user-not-found': 'No account found with this email.',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/invalid-credential': 'Invalid email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment.',
  'auth/popup-blocked': 'Pop-up blocked — allow pop-ups or use email sign-in.',
  'auth/unauthorized-domain': 'Domain not authorized. Please use email sign-in.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled.',
}[code] ?? 'Something went wrong. Please try again.');

export default function Login({
  onGoogleSignIn, onEmailSignIn, onEmailSignUp, onResetPassword, onAnonymousSignIn,
  navigate, initialMode = 'sign-in',
}: AuthFns) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });

  useEffect(() => { setError(''); setSuccess(''); }, [mode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(''); setSuccess(''); setSubmitting(true);
    try {
      if (mode === 'sign-in') {
        await onEmailSignIn(form.email.trim(), form.password);
      } else {
        if (!form.fullName.trim() || !form.email.trim() || !form.password) {
          setError('Please fill name, email, and password.'); return;
        }
        if (form.password.length < 6) {
          setError('Password must be at least 6 characters.'); return;
        }
        await onEmailSignUp(form.email.trim(), form.password, form.fullName.trim());
      }
    } catch (err: any) {
      setError(friendlyError(err?.code ?? ''));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (googleLoading) return;
    setError(''); setGoogleLoading(true);
    try { await onGoogleSignIn(); }
    catch (err: any) { setError(friendlyError(err?.code ?? '')); }
    finally { setGoogleLoading(false); }
  };

  const handleGuest = async () => {
    if (guestLoading) return;
    setError(''); setGuestLoading(true);
    try { await onAnonymousSignIn(); }
    catch (err: any) { setError(friendlyError(err?.code ?? '')); }
    finally { setGuestLoading(false); }
  };

  const handleForgot = async () => {
    if (!form.email.trim()) { setError('Enter your email first to reset password.'); return; }
    setError(''); setSuccess('');
    try {
      await onResetPassword(form.email.trim());
      setSuccess('Password reset email sent. Check your inbox.');
    } catch (err: any) { setError(friendlyError(err?.code ?? '')); }
  };

  return (
    <div className="lg-page">
      <div className="lg-box">
        <img src={auraImg} alt="" className="lg-box-aura" aria-hidden="true" draggable={false} width={1200} height={800} loading="lazy" decoding="async" />

        <button
          type="button"
          onClick={() => navigate('/')}
          className="lg-home-btn"
          aria-label="Back to home"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="lg-box-left">
        <div className="lg-form-card">
          <h1 className="lg-heading">
            {mode === 'sign-in' ? 'Sign in to your account' : 'Create your account'}
          </h1>
          <p className="lg-sub">
            {mode === 'sign-in'
              ? 'Enter your credentials to view your dashboard.'
              : 'Build your AI-powered second brain. Free forever.'}
          </p>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading || submitting}
            className="lg-google-btn"
            data-testid="button-login-google"
          >
            {googleLoading ? (
              <Loader2 size={16} className="lg-spin" />
            ) : (
              <>
                <svg className="lg-google-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#EA4335" d="M12 5.04c1.95 0 3.7.67 5.07 1.98l3.78-3.78C18.42 1 15.46 0 12 0 7.31 0 3.26 2.69 1.28 6.61l4.42 3.42C6.74 7.04 9.14 5.04 12 5.04z" />
                  <path fill="#4285F4" d="M23.49 12.27c0-.78-.07-1.53-.2-2.27H12v4.51h6.47c-.28 1.5-1.13 2.78-2.41 3.64l3.69 2.86c2.16-2 3.74-4.95 3.74-8.74z" />
                  <path fill="#FBBC05" d="M5.7 14.2a7.06 7.06 0 0 1 0-4.4L1.28 6.4A12 12 0 0 0 0 12c0 1.94.46 3.78 1.28 5.4l4.42-3.2z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.69-2.86c-1.02.69-2.34 1.1-4.26 1.1-2.86 0-5.27-2-6.13-4.7l-4.42 3.42C3.26 21.31 7.31 24 12 24z" />
                </svg>
                <span>Continue with Google</span>
              </>
            )}
          </button>

          <div className="lg-divider"><span>OR</span></div>

          <form onSubmit={handleSubmit} className="lg-form" autoComplete="on">
            {mode === 'sign-up' && (
              <div className="lg-field-group">
                <label htmlFor="fullName" className="lg-label">FULL NAME</label>
                <div className="lg-field">
                  <UserIcon size={15} className="lg-field-icon" aria-hidden="true" />
                  <input
                    id="fullName" name="fullName" type="text" autoComplete="name"
                    placeholder="Enter your full name"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="lg-input"
                    data-testid="input-fullname"
                  />
                </div>
              </div>
            )}

            <div className="lg-field-group">
              <label htmlFor="email" className="lg-label">EMAIL ADDRESS</label>
              <div className="lg-field">
                <Mail size={15} className="lg-field-icon" aria-hidden="true" />
                <input
                  id="email" name="email" type="email" autoComplete="email" required
                  placeholder="Enter your email address"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="lg-input"
                  data-testid="input-email"
                />
              </div>
            </div>

            <div className="lg-field-group">
              <label htmlFor="password" className="lg-label">PASSWORD</label>
              <div className="lg-field">
                <Lock size={15} className="lg-field-icon" aria-hidden="true" />
                <input
                  id="password" name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  required minLength={6}
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="lg-input"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="lg-field-toggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {mode === 'sign-in' && (
                <button type="button" onClick={handleForgot} className="lg-forgot">
                  Forgot password?
                </button>
              )}
            </div>

            {error && (
              <div className="lg-alert lg-alert-error">{error}</div>
            )}
            {success && (
              <div className="lg-alert lg-alert-success">{success}</div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={`lg-submit ${submitting ? 'is-loading' : ''}`}
              data-testid="button-submit"
            >
              <span className="lg-submit-shine" />
              {submitting ? (
                <Loader2 size={16} className="lg-spin lg-submit-z" />
              ) : (
                <>
                  <span className="lg-submit-z">{mode === 'sign-in' ? 'Sign in' : 'Create account'}</span>
                  <ArrowRight size={15} className="lg-submit-arrow lg-submit-z" />
                </>
              )}
            </button>
          </form>

          <div className="lg-mode-toggle">
            {mode === 'sign-in' ? (
              <>
                Don&apos;t have an account?{' '}
                <button type="button" onClick={() => setMode('sign-up')} data-testid="link-toggle-signup">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button type="button" onClick={() => setMode('sign-in')} data-testid="link-toggle-signin">
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className="lg-guest-sep">or</div>

          <button
            type="button"
            onClick={handleGuest}
            disabled={guestLoading}
            className="lg-guest-btn"
            data-testid="button-guest"
          >
            {guestLoading ? <Loader2 size={14} className="lg-spin" /> : <UserIcon size={14} />}
            <span>Continue as Guest</span>
          </button>
          <p style={{
            margin: '8px 4px 0', textAlign: 'center', fontSize: 11,
            color: '#8a93a8', lineHeight: 1.45, letterSpacing: '0.01em',
          }}>
            Guest loads a pre-filled demo brain so you can explore.
            Real accounts always start fresh — your data stays private to you.
          </p>

          <div className="lg-trust">
            <div className="lg-trust-item">
              <ShieldCheck size={12} />
              <span>Bank-grade security</span>
            </div>
            <span className="lg-trust-dot" />
            <div className="lg-trust-item">
              <Sparkles size={12} />
              <span>Instant access</span>
            </div>
          </div>
        </div>
        </div>

        {/* ── RIGHT: 3D padlock visual inside the box ─────── */}
        <div className="lg-box-right" aria-hidden="true">
          <img src={keyholeImg} alt="" className="lg-right-img" width={620} height={620} loading="lazy" decoding="async" />
          <div className="lg-right-vignette" />
        </div>

        {/* ── Corner brand logo ───────────────────────────── */}
        <img src={x247Logo} alt="x247 AI" className="lg-corner-logo" draggable={false} width={120} height={32} decoding="async" fetchPriority="high" />
      </div>
    </div>
  );
}
