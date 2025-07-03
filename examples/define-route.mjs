import { H3, defineRoute } from "h3";

// Mock Zod-like schema for demonstration
// In real usage, you'd import from 'zod', 'valibot', etc.
const createBookSchema = {
  "~standard": {
    version: 1,
    vendor: "zod",
    validate: (value) => {
      // Simple validation for demo
      if (!value || typeof value !== "object") {
        return { issues: [{ message: "Invalid input" }] };
      }
      if (!value.title || typeof value.title !== "string") {
        return { issues: [{ message: "Title is required" }] };
      }
      return { value, issues: undefined };
    },
  },
};

const paramsSchema = {
  "~standard": {
    version: 1,
    vendor: "zod",
    validate: (value) => ({ value, issues: undefined }),
  },
};

const app = new H3();

// Register route plugins
app.register(defineRoute({
  method: "GET",
  route: "/health",
  handler: async (_event) => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  },
}));

app.register(defineRoute({
  method: "GET",
  route: "/api/books",
  meta: { cache: "5m" },
  handler: async (_event) => {
    return {
      books: [
        { id: "1", title: "h3 Guide" },
        { id: "2", title: "Modern Web APIs" },
      ],
    };
  },
}));

app.register(defineRoute({
  method: "POST",
  route: "/api/books",
  input: createBookSchema,
  meta: { auth: true, rateLimit: 10 },
  handler: async (_event) => {
    // Input is automatically validated!
    return {
      message: "Book created successfully!",
      id: Math.random().toString(36),
    };
  },
}));

app.register(defineRoute({
  method: "GET",
  route: "/api/books/:id",
  routerParams: paramsSchema,
  meta: { public: true },
  middleware: [
    async (event, next) => {
      console.log(`Accessing book: ${event.context.params?.id}`);
      return next();
    },
  ],
  handler: async (event) => {
    // Path params and middleware are handled automatically
    return {
      message: "Book retrieved",
      book: { id: event.context.params?.id, title: "Sample Book" },
    };
  },
}));

app.register(defineRoute({
  method: "GET",
  route: "/admin/stats",
  meta: { auth: true, admin: true },
  middleware: [
    async (event, next) => {
      console.log("Admin API access:", event.url.pathname);
      return next();
    },
  ],
  handler: async (_event) => ({
    totalBooks: 42,
    totalUsers: 1337,
  }),
}));

app.register(defineRoute({
  method: "DELETE",
  route: "/admin/books/:id",
  routerParams: paramsSchema,
  meta: { auth: true, admin: true },
  handler: async (event) => ({
    message: `Book ${event.context.params?.id} deleted by admin`,
  }),
}));

console.log("🚀 h3 server with defineRoute plugin registration");
console.log("📚 Try these endpoints:");
console.log("  GET  /health");
console.log("  GET  /api/books");
console.log("  GET  /api/books/123");
console.log('  POST /api/books (with JSON body: {"title": "My Book"})');
console.log("  GET  /admin/stats");
console.log("  DELETE /admin/books/123");
console.log("");
console.log("✨ Features demonstrated:");
console.log("  - Plugin-based registration with app.register()");
console.log("  - Automatic validation with schemas");
console.log("  - Route meta (auth, cache, etc.)");
console.log("  - Middleware integration");

export default app;
