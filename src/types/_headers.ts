import type { HTTPMethod } from ".";
import type { MimeType } from "./_mimes";
import type { AnyString, AnyNumber } from "./_utils";

export type RequestHeaders = Partial<
  Record<HTTPHeaderName, string | undefined>
>;

// prettier-ignore
type _HTTPHeaderName = "WWW-Authenticate" | "Authorization" | "Proxy-Authenticate" | "Proxy-Authorization" | "Age" | "Cache-Control" | "Clear-Site-Data" | "Expires" | "Pragma" | "Accept-CH" | "Critical-CH" | "Sec-CH-UA" | "Sec-CH-UA-Arch" | "Sec-CH-UA-Bitness" | "Sec-CH-UA-Full-Version-List" | "Sec-CH-UA-Mobile" | "Sec-CH-UA-Model" | "Sec-CH-UA-Platform" | "Sec-CH-UA-Platform-Version" | "Sec-CH-UA-Prefers-Color-Scheme" | "Sec-CH-UA-Prefers-Reduced-Motion" | "Downlink" | "ECT" | "RTT" | "Save-Data" | "Last-Modified" | "ETag" | "If-Match" | "If-None-Match" | "If-Modified-Since" | "If-Unmodified-Since" | "Vary" | "Connection" | "Keep-Alive" | "Accept" | "Accept-Encoding" | "Accept-Language" | "Expect" | "Max-Forwards" | "Cookie" | "Set-Cookie" | "Access-Control-Allow-Origin" | "Access-Control-Allow-Credentials" | "Access-Control-Allow-Headers" | "Access-Control-Allow-Methods" | "Access-Control-Expose-Headers" | "Access-Control-Max-Age" | "Access-Control-Request-Headers" | "Access-Control-Request-Method" | "Origin" | "Timing-Allow-Origin" | "Content-Disposition" | "Content-Length" | "Content-Type" | "Content-Encoding" | "Content-Language" | "Content-Location" | "Forwarded" | "X-Forwarded-For" | "X-Forwarded-Host" | "X-Forwarded-Proto" | "Via" | "Location" | "Refresh" | "From" | "Host" | "Referer" | "Referrer-Policy" | "User-Agent" | "Allow" | "Server" | "Accept-Ranges" | "Range" | "If-Range" | "Content-Range" | "Cross-Origin-Embedder-Policy" | "Cross-Origin-Opener-Policy" | "Cross-Origin-Resource-Policy" | "Content-Security-Policy" | "Content-Security-Policy-Report-Only" | "Expect-CT" | "Origin-Isolation" | "Permissions-Policy" | "Strict-Transport-Security" | "Upgrade-Insecure-Requests" | "X-Content-Type-Options" | "X-Frame-Options" | "X-Permitted-Cross-Domain-Policies" | "X-Powered-By" | "X-XSS-Protection" | "Sec-Fetch-Site" | "Sec-Fetch-Mode" | "Sec-Fetch-User" | "Sec-Fetch-Dest" | "Sec-Purpose" | "Service-Worker-Navigation-Preload" | "Last-Event-ID" | "NEL" | "Ping-From" | "Ping-To" | "Report-To" | "Transfer-Encoding" | "TE" | "Trailer" | "Sec-WebSocket-Key" | "Sec-WebSocket-Extensions" | "Sec-WebSocket-Accept" | "Sec-WebSocket-Protocol" | "Sec-WebSocket-Version" | "Accept-Push-Policy" | "Accept-Signature" | "Alt-Svc" | "Alt-Used" | "Date" | "Early-Data" | "Link" | "Push-Policy" | "Retry-After" | "Signature" | "Signed-Headers" | "Server-Timing" | "Service-Worker-Allowed" | "SourceMap" | "Upgrade" | "X-DNS-Prefetch-Control" | "X-Pingback" | "X-Requested-With" | "X-Robots-Tag";

export type HTTPHeaderName =
  _HTTPHeaderName | Lowercase<_HTTPHeaderName> | (string & {});

// prettier-ignore
type ClientHint = "Sec-CH-UA" | "Sec-CH-UA-Arch" | "Sec-CH-UA-Bitness" | "Sec-CH-UA-Full-Version-List" | "Sec-CH-UA-Full-Version" | "Sec-CH-UA-Mobile" | "Sec-CH-UA-Model" | "Sec-CH-UA-Platform" | "Sec-CH-UA-Platform-Version" | "Sec-CH-Prefers-Reduced-Motion" | "Sec-CH-Prefers-Color-Scheme" | "Device-Memory" | "Width" | "Viewport-Width" | "Save-Data" | "Downlink" | "ECT" | "RTT" | AnyString;

export type TypedHeaders = Partial<Record<HTTPHeaderName, unknown>> &
  Partial<{
    host: string;

    location: string;

    referrer: string;

    origin: "null" | AnyString;

    from: string;

    "alt-used": string;

    "content-location": string;

    sourcemap: string;

    "content-length": number;

    "access-control-max-age": number;

    "retry-after": number;

    rtt: number;

    age: number;

    "max-forwards": number;

    downlink: number;

    "device-memory": 0.25 | 0.5 | 1 | 2 | 4 | 8 | AnyNumber;

    accept: MimeType | MimeType[] | `${MimeType};q=${number}`[];

    "content-type": MimeType;

    "accept-ch": ClientHint | ClientHint[];

    "keep-alive": `timeout=${number}, max=${number}` | AnyString;

    "access-control-allow-credentials": "true" | AnyString;

    "access-control-allow-headers": "*" | HTTPHeaderName[] | AnyString;

    "access-control-allow-methods": "*" | HTTPMethod[] | AnyString;

    "access-control-allow-origin": "*" | "null" | AnyString;

    "access-control-expose-headers": "*" | HTTPHeaderName[] | AnyString;

    "access-control-request-headers": HTTPHeaderName[] | AnyString;

    "access-control-request-method": HTTPMethod | AnyString;

    "early-data": 1;

    "upgrade-insecure-requests": 1;

    // prettier-ignore
    "accept-ranges": "bytes" | "none" | AnyString;

    // prettier-ignore
    connection: "keep-alive" | "close" | "upgrade" | AnyString;

    // prettier-ignore
    ect: "slow-2g" | "2g" | "3g" | "4g" | AnyString;

    // prettier-ignore
    expect: "100-continue" | AnyString;

    // prettier-ignore
    "save-data": `on` | `off` | AnyString;

    // prettier-ignore
    "sec-ch-prefers-reduced-motion": "no-preference" | "reduce" | AnyString;

    // prettier-ignore
    "sec-ch-prefers-reduced-transparency": "no-preference" | "reduce" | AnyString;

    // prettier-ignore
    "sec-ch-ua-mobile": `?1` | `?0` | AnyString;

    // prettier-ignore
    "origin-agent-cluster": `?1` | `?0` | AnyString;

    // prettier-ignore
    "sec-fetch-user": "?1" | AnyString;

    // prettier-ignore
    "sec-purpose": "prefetch" | AnyString;

    // prettier-ignore
    "x-content-type-options": "nosniff" | AnyString;

    // prettier-ignore
    "x-dns-prefetch-control": "on" | "off" | AnyString;

    // prettier-ignore
    "x-frame-options": "DENY" | "SAMEORIGIN" | AnyString;

    // prettier-ignore
    "sec-ch-ua-arch": "x86" | "ARM" | "[arm64-v8a, armeabi-v7a, armeabi]" | AnyString;

    // prettier-ignore
    "sec-fetch-site": "cross-site" | "same-origin" | "same-site" | "none" | AnyString;

    // prettier-ignore
    "sec-ch-prefers-color-scheme": "dark" | "light" | AnyString;

    // prettier-ignore
    "sec-ch-ua-bitness": "64" | "32" | AnyString;

    // prettier-ignore
    "sec-fetch-mode": "cors" | "navigate" | "no-cors" | "same-origin" | "websocket" | AnyString;

    // prettier-ignore
    "cross-origin-embedder-policy": "unsafe-none" | "require-corp" | "credentialless" | AnyString;

    // prettier-ignore
    "cross-origin-opener-policy": "unsafe-none" | "same-origin-allow-popups" | "same-origin" | AnyString;

    // prettier-ignore
    "cross-origin-resource-policy": "same-site" | "same-origin" | "cross-origin" | AnyString;

    // prettier-ignore
    "sec-ch-ua-platform":  "Android" | "Chrome  OS" | "Chromium  OS" | "iOS" | "Linux" | "macOS" | "Windows" | "Unknown" | AnyString;

    // prettier-ignore
    "referrer-policy":  "no-referrer" | "no-referrer-when-downgrade" | "origin" | "origin-when-cross-origin" | "same-origin" | "strict-origin" | "strict-origin-when-cross-origin" | "unsafe-url" | AnyString;

    // prettier-ignore
    "sec-fetch-dest":  "audio" | "audioworklet" | "document" | "embed" | "empty" | "font" | "frame" | "iframe" | "image" | "manifest" | "object" | "paintworklet" | "report" | "script" | "serviceworker" | "sharedworker" | "style" | "track" | "video" | "worker" | "xslt" | AnyString;
  }>;
