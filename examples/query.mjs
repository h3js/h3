import { H3, serve, html, defineQueryHandler } from "../dist/_entries/node.mjs";

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

// `defineQueryHandler` wires up the RFC 10008 ceremony: it advertises the
// accepted formats via `Accept-Query` on every response (including errors),
// validates the request `Content-Type` (throws 400/415/422), and passes the
// matched media type and the query to the handler.
//
// The `get` option makes the same handler serve an equivalent, HTTP-cacheable
// GET (`/books?q=<query>&format=<format>`): successful QUERY responses
// advertise it via `Content-Location` (RFC 10008 §2.3), and a client
// repeating the query can just GET that URL — no server-side result store.
const searchBooks = defineQueryHandler({
  formats: ACCEPTED,
  get: "q",
  handler: (event, { format, query }) => {
    if (event.req.method === "GET") {
      // Unlike a QUERY response, this GET is safe for browsers/CDNs to cache.
      event.res.headers.set("cache-control", "public, max-age=60");
    }
    return runQuery(format, query.trim());
  },
});

export const app = new H3();

app
  .get("/", () => page)
  .get("/books", searchBooks)
  .query("/books", searchBooks);

serve(app);

// Or try it from the terminal:
//   # Discover the accepted query formats (every response advertises them):
//   curl -i http://localhost:3000/books
//   # -> 400, Accept-Query: application/sql, application/jsonpath
//
//   # SQL query (note the `Content-Location` header in the response):
//   curl -i -X QUERY http://localhost:3000/books \
//     -H "Content-Type: application/sql" \
//     --data "SELECT * FROM books WHERE author = 'Simpson'"
//   # -> 200, Content-Location: /books?q=SELECT+...&format=application%2Fsql
//
//   # Re-run the same query via the equivalent, cacheable GET:
//   curl -i "http://localhost:3000/books?q=SELECT%20*%20FROM%20books%20WHERE%20author%20=%20'Simpson'&format=application/sql"
//   # -> 200, Cache-Control: public, max-age=60
//
//   # Or probe it with HEAD (served automatically via the GET route):
//   curl -I "http://localhost:3000/books?q=SELECT%20*%20FROM%20books%20WHERE%20author%20=%20'Simpson'&format=application/sql"
//   # -> 200, same headers, no body
//
//   # JSONPath query:
//   curl -X QUERY http://localhost:3000/books \
//     -H "Content-Type: application/jsonpath" \
//     --data '$[?(@.year==2015)]'
//
//   # Unsupported format:
//   curl -i -X QUERY http://localhost:3000/books -H "Content-Type: text/plain" --data x
//   # -> 415 Unsupported Media Type
