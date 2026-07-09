import {
  H3,
  serve,
  html,
  getRouterParam,
  appendAcceptQuery,
  requireContentType,
  readBody,
  HTTPError,
} from "../dist/_entries/node.mjs";

// The HTTP QUERY method (RFC 10008) is a safe, idempotent request that carries a
// query in its BODY — useful when a query is too large or too structured for the
// URL. Here a `/books` resource accepts queries in two formats: SQL-ish and JSONPath.
// Open http://localhost:3000 for a small interactive demo.

const BOOKS = [
  { title: "The Go Programming Language", author: "Donovan", year: 2015 },
  { title: "Programming Rust", author: "Blandy", year: 2021 },
  { title: "You Don't Know JS", author: "Simpson", year: 2015 },
];

const ACCEPTED = ["application/sql", "application/jsonpath"];

// Results of past queries, keyed by a stable id, so the same query can be
// retrieved again through a cacheable GET (see `Content-Location` below).
const cache = new Map();

// Run a query and return the matching books.
function runQuery(type, query) {
  if (type === "application/jsonpath") {
    // e.g. `$[?(@.year==2015)]` — naive demo matcher on `year`.
    const year = Number(query.match(/@\.year==(\d+)/)?.[1]);
    return BOOKS.filter((b) => b.year === year);
  }
  // application/sql — e.g. `SELECT * FROM books WHERE author = 'Simpson'`.
  const author = query.match(/author\s*=\s*'([^']*)'/i)?.[1];
  return author ? BOOKS.filter((b) => b.author === author) : BOOKS;
}

// Stable id (FNV-1a) so identical queries map to the same cacheable URL.
function queryId(type, query) {
  let h = 0x81_1c_9d_c5;
  for (const ch of `${type}\n${query}`) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01_00_01_93);
  }
  return (h >>> 0).toString(16);
}

// A minimal self-contained page that sends QUERY requests to /books via fetch.
const page = html`<!doctype html>
  <title>H3 QUERY Demo</title>
  <style>
    body { font: 16px system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; }
    textarea { width: 100%; font-family: monospace; padding: 0.5rem; box-sizing: border-box; }
    pre { background: #f4f4f5; padding: 1rem; border-radius: 6px; overflow: auto; }
    .row { display: flex; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
  </style>
  <h1>H3 QUERY Demo</h1>
  <p>Send a query to <code>/books</code> using the HTTP <code>QUERY</code> method.</p>
  <div class="row">
    <label>Format:
      <select id="format">
        <option value="application/sql">application/sql</option>
        <option value="application/jsonpath">application/jsonpath</option>
      </select>
    </label>
    <button id="run">Run query</button>
  </div>
  <textarea id="query" rows="3">SELECT * FROM books WHERE author = 'Simpson'</textarea>
  <h3>Result <small id="status"></small></h3>
  <p id="cacheable"></p>
  <pre id="result">—</pre>
  <script type="module">
    const $ = (id) => document.getElementById(id);
    // Swap in a fitting example query when the format changes.
    const samples = {
      "application/sql": "SELECT * FROM books WHERE author = 'Simpson'",
      "application/jsonpath": "$[?(@.year==2015)]",
    };
    $("format").addEventListener("change", (e) => ($("query").value = samples[e.target.value]));
    $("run").addEventListener("click", async () => {
      const res = await fetch("/books", {
        method: "QUERY",
        headers: { "Content-Type": $("format").value },
        body: $("query").value,
      });
      $("status").textContent = res.status + " " + res.statusText;
      $("result").textContent = JSON.stringify(await res.json(), null, 2);
      // RFC 10008: the server advertises a cacheable GET alternative for this
      // exact query. Following it is a plain, HTTP-cacheable GET request.
      const location = res.headers.get("Content-Location");
      $("cacheable").innerHTML = location
        ? \`Cacheable GET: <a href="\${location}" target="_blank" rel="noopener">\${location}</a>\`
        : "";
    });
  </script>`;

export const app = new H3();

app
  .get("/", () => page)
  .get("/books", (event) => {
    // Advertise the accepted query formats on a plain GET too, so clients can
    // discover them before sending a QUERY request.
    appendAcceptQuery(event, ACCEPTED);
    return "Send a QUERY request to /books with a SQL or JSONPath body.";
  })
  .get("/books/:id", (event) => {
    // The cacheable GET alternative advertised by the QUERY response below.
    const result = cache.get(getRouterParam(event, "id"));
    if (!result) {
      throw new HTTPError({ status: 404, message: "Unknown query id" });
    }
    // Unlike a QUERY response, this GET is safe for browsers/CDNs to cache.
    event.res.headers.set("cache-control", "public, max-age=60");
    return result;
  })
  .query("/books", async (event) => {
    // Echo the accepted formats via the `Accept-Query` response header so a
    // successful response also advertises what this resource understands.
    appendAcceptQuery(event, ACCEPTED);

    // Validate the request `Content-Type`. Throws 400 (missing),
    // 422 (malformed), or 415 (unsupported) — and returns the matched type.
    const type = requireContentType(event, ACCEPTED);

    const query = (await readBody(event, { type: "text" }))?.trim() ?? "";
    const result = runQuery(type, query);

    // Offer a cacheable GET alternative for this exact query (RFC 10008): stash
    // the result under a stable id and point the client at it via
    // `Content-Location`. A client repeating this query can just GET that URL
    // and benefit from ordinary HTTP caching.
    const id = queryId(type, query);
    cache.set(id, result);
    event.res.headers.set("content-location", `/books/${id}`);

    return result;
  });

serve(app);

// Or try it from the terminal:
//   # Discover the accepted query formats:
//   curl -i http://localhost:3000/books
//   # -> Accept-Query: application/sql, application/jsonpath
//
//   # SQL query (note the `Content-Location` header in the response):
//   curl -i -X QUERY http://localhost:3000/books \
//     -H "Content-Type: application/sql" \
//     --data "SELECT * FROM books WHERE author = 'Simpson'"
//   # -> 200, Content-Location: /books/<id>
//
//   # Re-fetch the same result via the cacheable GET alternative:
//   curl -i http://localhost:3000/books/<id>
//   # -> 200, Cache-Control: public, max-age=60
//
//   # JSONPath query:
//   curl -X QUERY http://localhost:3000/books \
//     -H "Content-Type: application/jsonpath" \
//     --data '$[?(@.year==2015)]'
//
//   # Unsupported format:
//   curl -i -X QUERY http://localhost:3000/books -H "Content-Type: text/plain" --data x
//   # -> 415 Unsupported Media Type
