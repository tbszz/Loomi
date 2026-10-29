import { createTranslator } from '../i18n.js';
export const initialLoginState = Object.freeze({
  mode: 'login', email: '', password: '', name: '', focus: null,
  showPassword: false, capsLock: false, status: 'idle', error: '', errors: {}, attempt: 0,
});

// Mirror server/auth.js at the UI boundary. The server remains authoritative.
export function validateLogin(input, t = createTranslator()) {
  const values = {
    mode: input.mode === 'register' ? 'register' : 'login',
    email: String(input.email || '').trim().toLowerCase(),
    password: String(input.password || ''),
    name: String(input.name || '').trim(),
  };
  const errors = {};
  if (!values.email || values.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = t("login.invalidEmail");
  if (values.mode === 'register' && (!values.name || values.name.length > 120)) errors.name = t("login.invalidName");
  if (values.password.length < 10 || values.password.length > 128) errors.password = t("login.invalidPassword");
  return { values, errors };
}

export function loginReducer(state, action) {
  const busy = state.status === 'submitting' || state.status === 'success';
  switch (action.type) {
    case 'mode': return busy ? state : { ...state, mode: action.mode === 'register' ? 'register' : 'login', error: '', errors: {}, status: 'idle', showPassword: false, capsLock: false, focus: null };
    case 'change': return busy ? state : { ...state, [action.field]: action.value, status: 'idle', error: '', errors: { ...state.errors, [action.field]: undefined } };
    case 'focus': return { ...state, focus: action.field, capsLock: false };
    case 'caps': return { ...state, capsLock: action.value };
    case 'visibility': return busy ? state : { ...state, showPassword: !state.showPassword };
    case 'invalid': return { ...state, status: 'error', errors: action.errors, error: '', attempt: state.attempt + 1 };
    case 'submit': return busy ? state : { ...state, status: 'submitting', error: '', errors: {}, capsLock: false };
    case 'reject': return state.status !== 'submitting' ? state : { ...state, status: 'error', error: action.message, attempt: state.attempt + 1 };
    case 'resolve': return state.status !== 'submitting' ? state : { ...state, status: 'success', error: '', errors: {} };
    default: return state;
  }
}

export function loomiMood(state) {
  if (['submitting', 'success'].includes(state.status)) return state.status;
  if (state.focus === 'password') return state.showPassword ? 'peek' : 'covered';
  if (state.status === 'error') return 'error';
  return state.focus === 'email' || state.focus === 'name' ? 'typing' : 'idle';
}

export function pupilOffset(length) {
  return Math.max(-3, Math.min(3, (length - 16) * 3 / 16));
}
