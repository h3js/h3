export const FastURL: { new (url: string): URL } = /* @__PURE__ */ (() => {
  const FastURL = class URL implements globalThis.URL {
    #originalURL: string;
    #parsedURL: globalThis.URL | undefined;

    _pathname?: string;
    _urlqindex?: number;
    _query?: URLSearchParams;
    _search?: string;

    constructor(url: string) {
      this.#originalURL = url;
    }

    get _url(): globalThis.URL {
      if (!this.#parsedURL) {
        this.#parsedURL = new globalThis.URL(this.#originalURL);
      }
      return this.#parsedURL;
    }

    toString(): string {
      return this._url.toString();
    }

    toJSON(): string {
      return this.toString();
    }

    get pathname() {
      if (this.#parsedURL) {
        return this.#parsedURL.pathname;
      }
      if (!this._pathname) {
        const url = this.#originalURL;
        const protoIndex = url.indexOf("://");
        if (protoIndex === -1) {
          return this._url.pathname; // deoptimize
        }
        const pIndex = url.indexOf("/", protoIndex + 4 /* :// */);
        if (pIndex === -1) {
          return this._url.pathname; // deoptimize
        }
        const qIndex = (this._urlqindex = url.indexOf("?", pIndex));
        this._pathname = url.slice(pIndex, qIndex === -1 ? undefined : qIndex);
      }
      return this._pathname!;
    }

    set pathname(value: string) {
      this._url.pathname = value;
    }

    get searchParams() {
      if (this.#parsedURL) {
        return this.#parsedURL.searchParams;
      }
      if (!this._query) {
        this._query = new URLSearchParams(this.search);
      }
      return this._query;
    }

    get search() {
      if (this.#parsedURL) {
        return this.#parsedURL.search;
      }
      if (!this._search) {
        const qIndex = this._urlqindex;
        if (qIndex === -1) {
          this._search = "";
        } else {
          this._search =
            qIndex === undefined
              ? this._url.search // deoptimize (mostly unlikely unless pathname is not accessed)
              : this.#originalURL.slice(this._urlqindex);
        }
      }
      return this._search;
    }

    set search(value: string) {
      this._url.search = value;
    }

    declare hash: string;
    declare host: string;
    declare hostname: string;
    declare href: string;
    declare origin: string;
    declare password: string;
    declare port: string;
    declare protocol: string;
    declare username: string;
  };

  // prettier-ignore
  const slowProps = [
    "hash", "host", "hostname", "href", "origin",
    "password", "port", "protocol", "username"
  ] as const;

  for (const prop of slowProps) {
    Object.defineProperty(FastURL.prototype, prop, {
      get() {
        return this._url[prop];
      },
      set(value) {
        this._url[prop] = value;
      },
    });
  }

  Object.setPrototypeOf(FastURL, globalThis.URL);

  return FastURL as unknown as { new (url: string): URL };
})();
