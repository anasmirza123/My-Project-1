// Every call goes to the local server. Writes always send JSON (the server rejects anything else).
let pin = sessionStorage.getItem('cms-pin') || '';

export class ApiError extends Error {
  constructor(status, body) { super(body?.error?.message || 'Request failed'); this.status = status; this.code = body?.error?.code; this.detail = body?.error || {}; }
}

async function request(method, url, body, retried = false) {
  const hasBody = method !== 'GET';
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(pin ? { 'x-app-pin': pin } : {}) },
      body: hasBody ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'OFFLINE', message: 'Cannot reach the app. Is start.bat still running?' } });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data?.error?.code === 'PIN_REQUIRED' && !retried) {
    const p = window.prompt('Enter your PIN');
    if (p === null) throw new ApiError(401, data);
    pin = p; sessionStorage.setItem('cms-pin', p);
    return request(method, url, body, true);
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b),
  patch: (u, b) => request('PATCH', u, b),
  put: (u, b) => request('PUT', u, b),
};
export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString(); return s ? '?' + s : '';
};
