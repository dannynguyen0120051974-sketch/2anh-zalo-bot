/**
 * Khoá API (trang "Khoá API & Model", chỉ Quản trị): các khoá dịch vụ trong .env của Hermes + khoá cổng AI chính
 * (`model.api_key` trong config.yaml). Trình duyệt chỉ thấy: tên dễ hiểu, dùng cho tính năng nào, đã đặt chưa và 4 ký tự
 * cuối — KHÔNG BAO GIỜ thấy giá trị. "Kiểm tra" gọi một địa chỉ CỐ ĐỊNH của đúng dịch vụ đó (không theo dữ liệu người
 * dùng) và chỉ trả được/không + lý do ngắn. "Thay khoá" chỉ ghi (có .bak), trợ lý cần khởi động lại mới dùng khoá mới.
 */
import { readConfigYaml, editConfigYaml } from './config-yaml.js';
import { readEnvAll, SECRET_NAME, SECRET_VALUE, writeSecretEnvKey } from './env-file.js';

export const MODEL_KEY = 'model.api_key';
const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const bearer = (v) => ({ Authorization: `Bearer ${v}` });
/** Khoá quen thuộc: nhãn, tính năng dùng, cách kiểm tra (địa chỉ cố định). */
export const REGISTRY = [
  { key: MODEL_KEY, label: 'Cổng AI chính (9router…)', feature: 'Mọi câu trả lời của bot, giọng đọc, nghe giọng nói, trí nhớ' },
  { key: 'TAVILY_API_KEY', label: 'Tra web — Tavily', feature: 'Tìm kiếm thông tin trên mạng',
    test: (v) => ({ url: 'https://api.tavily.com/search', init: { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(v) }, body: JSON.stringify({ query: 'ping', max_results: 1 }) } }) },
  { key: 'EXA_API_KEY', label: 'Tra web — Exa', feature: 'Tìm kiếm thông tin trên mạng',
    test: (v) => ({ url: 'https://api.exa.ai/search', init: { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': v }, body: JSON.stringify({ query: 'ping', numResults: 1 }) } }) },
  { key: 'CORE_API_KEY', label: 'Học thuật — CORE', feature: 'Tra bài báo khoa học, tải PDF',
    test: (v) => ({ url: 'https://api.core.ac.uk/v3/search/works/?q=chemistry&limit=1', init: { headers: bearer(v) } }) },
  { key: 'OPENALEX_API_KEY', label: 'Học thuật — OpenAlex', feature: 'Tra bài báo khoa học (nhiều lượt hơn)' },
  { key: 'GEMINI_API_KEY', label: 'Google Gemini', feature: 'Gọi Gemini trực tiếp (giọng đọc/dự phòng)',
    test: (v) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(v)}`, init: {} }) },
  { key: 'CUSTOM_API_KEY', label: 'Cổng AI tuỳ chỉnh (biến môi trường)', feature: 'Khoá cổng AI đọc từ .env (thường trùng khoá cổng AI chính)' },
  { key: 'VBEE_API_KEY', label: 'Giọng đọc — Vbee', feature: 'Đọc tin nhắn thoại tiếng Việt' },
  { key: 'VBEE_ACCESS_TOKEN', label: 'Giọng đọc — Vbee (token)', feature: 'Đọc tin nhắn thoại tiếng Việt' },
  { key: 'APIFY_TOKEN', label: 'Thu thập web — Apify', feature: 'Đọc Facebook, TikTok, trang khó đọc',
    test: (v) => ({ url: 'https://api.apify.com/v2/users/me', init: { headers: bearer(v) } }) },
  { key: 'ANH_AI_KEY', label: 'Ảnh cho xưởng (2Anh Studio)', feature: 'Tạo ảnh minh hoạ trong slide, tài liệu' },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram', feature: 'Kênh Telegram của trợ lý',
    test: (v) => ({ url: `https://api.telegram.org/bot${v}/getMe`, init: {} }) },
  { key: 'DISCORD_BOT_TOKEN', label: 'Discord', feature: 'Kênh Discord của trợ lý',
    test: (v) => ({ url: 'https://discord.com/api/v10/users/@me', init: { headers: { Authorization: `Bot ${v}` } } }) },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', feature: 'Gọi OpenAI trực tiếp',
    test: (v) => ({ url: 'https://api.openai.com/v1/models', init: { headers: bearer(v) } }) },
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic', feature: 'Gọi Claude trực tiếp' },
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter', feature: 'Gọi model qua OpenRouter',
    test: (v) => ({ url: 'https://openrouter.ai/api/v1/auth/key', init: { headers: bearer(v) } }) },
  { key: 'FIRECRAWL_API_KEY', label: 'Đọc web — Firecrawl', feature: 'Đọc trang web khó' },
  { key: 'ELEVENLABS_API_KEY', label: 'Giọng đọc — ElevenLabs', feature: 'Giọng đọc' },
];
const KNOWN = new Map(REGISTRY.map((r) => [r.key, r]));
// Khoá nội bộ không cho sửa ở đây (đổi sẽ làm đứt kết nối của chính bot / webhook).
const INTERNAL = new Set(['VBEE_WEBHOOK_SECRET', 'OPENVIKING_API_KEY']);

/** "••••a1b2" — chỉ 4 ký tự cuối, và chỉ khi khoá đủ dài để 4 ký tự không đoán được phần còn lại. */
export const maskTail = (v) => (String(v).length >= 16 ? `••••${String(v).slice(-4)}` : '••••');

export function createAiKeys({ envFile, configFile, fetchImpl = fetch }) {
  const modelConf = () => readConfigYaml(configFile)?.model || {};
  function valueOf(key) {
    if (key === MODEL_KEY) return String(modelConf().api_key || '');
    return String(readEnvAll(envFile)[key] ?? '');
  }
  function editable(key) {
    return key === MODEL_KEY || (SECRET_NAME.test(key) && !INTERNAL.has(key));
  }
  return {
    /** Danh sách cho giao diện: khoá quen thuộc trước (kể cả chưa đặt), rồi khoá bí mật khác đang có trong .env. */
    list() {
      const env = readEnvAll(envFile);
      const row = (key, known) => {
        const v = key === MODEL_KEY ? String(modelConf().api_key || '') : String(env[key] ?? '');
        return { key, label: known?.label || key, feature: known?.feature || '', known: Boolean(known), set: Boolean(v), hint: v ? maskTail(v) : '',
          testable: Boolean(known?.test) || key === MODEL_KEY || (Boolean(v) && v === String(modelConf().api_key || '')), editable: editable(key) };
      };
      const known = REGISTRY.filter((r) => r.key === MODEL_KEY || Object.hasOwn(env, r.key) || ['TAVILY_API_KEY', 'CORE_API_KEY', 'GEMINI_API_KEY'].includes(r.key))
        .map((r) => row(r.key, r));
      const others = Object.keys(env).filter((k) => !KNOWN.has(k) && !INTERNAL.has(k) && SECRET_NAME.test(k)).sort().map((k) => row(k, null));
      const more = REGISTRY.filter((r) => !known.some((x) => x.key === r.key)).map((r) => ({ key: r.key, label: r.label, feature: r.feature }));
      return { keys: [...known, ...others], available: more };
    },
    /** Thay (hoặc gỡ khi rỗng) một khoá. Trả `changed`. */
    set(key, value) {
      const k = String(key ?? '');
      if (!editable(k)) throw err(400, 'Khoá này không đổi được ở đây — báo người cài đặt.');
      const v = String(value ?? '').trim();
      if (v && !SECRET_VALUE.test(v)) throw err(400, 'Khoá có ký tự lạ (khoảng trắng, nháy…) — dán lại đúng khoá dịch vụ cấp.');
      if (k === MODEL_KEY && !v) throw err(400, 'Không gỡ được khoá cổng AI chính — bot sẽ ngừng trả lời.');
      if (valueOf(k) === v) return false;
      if (k === MODEL_KEY) editConfigYaml(configFile, [{ path: ['model', 'api_key'], value: v }]);
      else writeSecretEnvKey(envFile, k, v);
      return true;
    },
    /** Gọi thử dịch vụ bằng khoá đang lưu: { ok, ms, detail }. Không bao giờ trả khoá hay nội dung phản hồi thô. */
    async test(key) {
      const k = String(key ?? '');
      const v = valueOf(k);
      if (!v) throw err(400, 'Chưa đặt khoá này.');
      let req;
      // Khoá giống hệt khoá cổng AI chính (vd. GEMINI_API_KEY dùng qua 9router) → kiểm qua cổng AI, không gọi thẳng Google.
      const viaGateway = k === MODEL_KEY || (k !== MODEL_KEY && v === String(modelConf().api_key || ''));
      if (viaGateway) {
        const base = String(modelConf().base_url || '').replace(/\/+$/, '');
        if (!/^https?:\/\//.test(base)) throw err(409, 'config.yaml chưa có model.base_url.');
        req = { url: `${base}/models`, init: { headers: bearer(v) } };
      } else {
        const known = KNOWN.get(k);
        if (!known?.test) throw err(400, 'Dịch vụ này chưa có cách kiểm tra tự động.');
        req = known.test(v);
      }
      const t0 = Date.now();
      try {
        const res = await fetchImpl(req.url, { ...req.init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
        const ms = Date.now() - t0;
        if (res.ok) return { ok: true, ms, detail: viaGateway && k !== MODEL_KEY ? 'Khoá hoạt động (dùng qua cổng AI chính).' : 'Khoá hoạt động.' };
        const detail = res.status === 401 || res.status === 403 || (res.status === 400 && k === 'GEMINI_API_KEY') ? 'Khoá sai hoặc đã bị thu hồi.'
          : res.status === 429 ? 'Khoá đúng nhưng đang hết lượt / bị giới hạn — thử lại sau.'
            : res.status === 402 ? 'Khoá đúng nhưng tài khoản hết tiền/hạn mức.' : `Dịch vụ trả lỗi ${res.status}.`;
        return { ok: false, ms, detail };
      } catch {
        return { ok: false, ms: Date.now() - t0, detail: 'Không gọi được dịch vụ (mạng hoặc dịch vụ đang lỗi).' };
      }
    },
  };
}
