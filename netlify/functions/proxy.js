/**
 * Arcade mini-proxy — Netlify Function.
 * GET /.netlify/functions/proxy?url=<target>&home=<arcade origin>
 *
 * Fetches a page server-side and rewrites its links/images/forms to stay
 * inside the proxy, for light browsing of simple sites from the arcade's
 * proxy.html. Not a general-purpose proxy: no cookie persistence, no
 * WebSockets, JavaScript-heavy sites will mostly not work — by design
 * this is the "simple sites" tier.
 *
 * Safety: http/https only; private/loopback/link-local targets blocked
 * (SSRF); self-recursion blocked; ~5 MB response cap; GET/HEAD only.
 */

const MAX_BYTES = 5 * 1024 * 1024;

function isBlockedHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv4 literals in private / loopback / link-local ranges
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  if (h.includes(".netlify/functions/proxy")) return true;
  return false;
}

function proxyUrl(selfBase, target, home) {
  let u = selfBase + "?url=" + encodeURIComponent(target);
  if (home) u += "&home=" + encodeURIComponent(home);
  return u;
}

function absolutize(raw, baseUrl) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s.startsWith("data:") || s.startsWith("javascript:") || s.startsWith("mailto:") ||
      s.startsWith("tel:") || s.startsWith("#") || s.startsWith("blob:")) return null;
  try { return new URL(s, baseUrl).toString(); } catch (e) { return null; }
}

function rewriteHtml(html, pageUrl, selfBase, home) {
  const wrap = (raw) => {
    const abs = absolutize(raw, pageUrl);
    return abs ? proxyUrl(selfBase, abs, home) : raw;
  };
  let out = html;
  // strip <base> so relative resolution stays ours
  out = out.replace(/<base\b[^>]*>/gi, "");
  // href / src / action / poster / background attributes (quoted or bare)
  out = out.replace(/\b(href|src|action|poster|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (m, attr, dq, sq, bare) => {
      const val = dq !== undefined ? dq : (sq !== undefined ? sq : bare);
      return attr + '="' + wrap(val).replace(/"/g, "%22") + '"';
    });
  // srcset: rewrite each candidate URL
  out = out.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (m, q, dq, sq) => {
      const val = dq !== undefined ? dq : sq;
      const quote = q.charAt(0);
      const fixed = val.split(",").map(part => {
        const bits = part.trim().split(/\s+/);
        if (bits.length) bits[0] = wrap(bits[0]);
        return bits.join(" ");
      }).join(", ");
      return "srcset=" + quote + fixed + quote;
    });
  // meta refresh
  out = out.replace(/(<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]+content\s*=\s*")([^"]*)(")/gi,
    (m, pre, content, post) => {
      const fixed = content.replace(/url\s*=\s*(.+)$/i, (mm, u) => "url=" + wrap(u.trim()));
      return pre + fixed + post;
    });
  // CSS url(...) in <style> blocks and inline style attributes
  const cssWrap = (css) => css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (m, q, u) => "url(" + q + wrap(u) + q + ")");
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (m, open, css, close) => open + cssWrap(css) + close);
  out = out.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (m, q, dq, sq) => {
      const val = dq !== undefined ? dq : sq;
      const quote = q.charAt(0);
      return "style=" + quote + cssWrap(val) + quote;
    });
  // inject the arcade nav bar
  const homeLink = home ? home.replace(/"/g, "%22") + "/proxy.html" : "/proxy.html";
  const bar =
    '<div style="position:sticky;top:0;z-index:2147483647;background:#000;color:#fff;' +
    'border-bottom:3px solid #ffff00;padding:6px 8px;font-family:monospace;font-size:13px;' +
    'display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<a href="' + homeLink + '" style="color:#ffff00;text-decoration:none;font-weight:bold">🕹️ EXIT PROXY</a>' +
    '<form method="GET" action="' + selfBase + '" style="display:flex;gap:6px;flex:1;min-width:200px;margin:0">' +
    (home ? '<input type="hidden" name="home" value="' + home.replace(/"/g, "&quot;") + '">' : "") +
    '<input name="url" value="' + pageUrl.replace(/"/g, "&quot;") + '" ' +
    'style="flex:1;background:#111;color:#fff;border:2px solid #666;padding:4px 8px;font-family:monospace;font-size:13px">' +
    '<button type="submit" style="background:#ffff00;color:#000;border:0;padding:4px 12px;' +
    'font-family:monospace;font-weight:bold;cursor:pointer">GO</button></form></div>';
  if (/<body\b[^>]*>/i.test(out)) out = out.replace(/<body\b[^>]*>/i, (m) => m + bar);
  else out = bar + out;
  return out;
}

function rewriteCss(css, pageUrl, selfBase, home) {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, u) => {
    const abs = absolutize(u, pageUrl);
    return abs ? "url(" + q + proxyUrl(selfBase, abs, home) + q + ")" : m;
  }).replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => {
    const abs = absolutize(u, pageUrl);
    return abs ? "@import " + q + proxyUrl(selfBase, abs, home) + q : m;
  });
}

exports.handler = async (event) => {
  const baseHeaders = { "Access-Control-Allow-Origin": "*" };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { ...baseHeaders, "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS" }, body: "" };
  }
  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD") {
    return { statusCode: 405, headers: baseHeaders, body: "GET only" };
  }
  const params = event.queryStringParameters || {};
  const raw = params.url;
  const home = params.home || "";
  if (!raw) {
    return {
      statusCode: 200,
      headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8" },
      body: "<!doctype html><title>Arcade Proxy</title><body style='background:#000;color:#fff;font-family:monospace;padding:20px'><h1>🕹️ ARCADE PROXY</h1><p>Add ?url=https://example.com</p></body>",
    };
  }
  let target;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch (e) {
    return { statusCode: 400, headers: baseHeaders, body: "bad url" };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { statusCode: 400, headers: baseHeaders, body: "http/https only" };
  }
  if (target.toString().includes("/.netlify/functions/proxy")) {
    return { statusCode: 403, headers: baseHeaders, body: "the proxy cannot proxy itself" };
  }
  if (isBlockedHost(target.hostname)) {
    return { statusCode: 403, headers: baseHeaders, body: "that address is blocked" };
  }
  const selfBase = "https://" + (event.headers.host || "gasterindeltarune.netlify.app") + "/.netlify/functions/proxy";

  let resp;
  try {
    resp = await fetch(target.toString(), {
      method: event.httpMethod,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JoslynsArcadeProxy/1.0; +https://joslyns-arcade.surge.sh/proxy.html)",
        "Accept": event.headers.accept || "*/*",
        "Accept-Language": event.headers["accept-language"] || "en",
      },
    });
  } catch (e) {
    return { statusCode: 502, headers: baseHeaders, body: "could not fetch that site: " + (e && e.message ? e.message : e) };
  }

  // keep redirects inside the proxy
  if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
    const loc = absolutize(resp.headers.get("location"), target.toString());
    if (loc) {
      return {
        statusCode: 302,
        headers: { ...baseHeaders, "Location": proxyUrl(selfBase, loc, home) },
        body: "",
      };
    }
  }

  const len = parseInt(resp.headers.get("content-length") || "0", 10);
  if (len && len > MAX_BYTES) {
    return { statusCode: 413, headers: baseHeaders, body: "that page is too large for the mini proxy (5 MB cap)" };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return { statusCode: 413, headers: baseHeaders, body: "that page is too large for the mini proxy (5 MB cap)" };
  }

  const ctype = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
  const outHeaders = {
    ...baseHeaders,
    "Content-Type": resp.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "no-store",
  };
  // deliberately NOT forwarded: content-security-policy, x-frame-options,
  // set-cookie, content-length (body may be rewritten)

  const finalUrl = target.toString();
  if (ctype === "text/html") {
    const charset = ((resp.headers.get("content-type") || "").match(/charset=([\w-]+)/i) || [])[1] || "utf-8";
    let text;
    try { text = new TextDecoder(charset).decode(buf); } catch (e) { text = buf.toString("utf8"); }
    return { statusCode: resp.status, headers: outHeaders, body: rewriteHtml(text, finalUrl, selfBase, home) };
  }
  if (ctype === "text/css") {
    return { statusCode: resp.status, headers: outHeaders, body: rewriteCss(buf.toString("utf8"), finalUrl, selfBase, home) };
  }
  const texty = ctype.startsWith("text/") || ctype.includes("javascript") || ctype.includes("json") || ctype.includes("xml");
  if (texty) {
    return { statusCode: resp.status, headers: outHeaders, body: buf.toString("utf8") };
  }
  return { statusCode: resp.status, headers: outHeaders, body: buf.toString("base64"), isBase64Encoded: true };
};
