import { H3, defineRoute } from "h3";
import { z } from "zod";

// Real Zod schemas for validation
const createBookSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  author: z.string().min(1, "Author is required"),
  publishedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

const bookParamsSchema = z.object({
  id: z.string().uuid("Invalid book ID format"),
});

const bookQuerySchema = z.object({
  page: z
    .string()
    .transform((val) => Number.parseInt(val, 10))
    .optional(),
  limit: z
    .string()
    .transform((val) => Number.parseInt(val, 10))
    .optional(),
  search: z.string().optional(),
  sortBy: z.enum(["title", "author", "publishedAt"]).optional(),
});

// Output schemas for response validation
const bookResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  author: z.string(),
  description: z.string().optional(),
  publishedAt: z.string().datetime(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

const booksListResponseSchema = z.object({
  books: z.array(bookResponseSchema),
  pagination: z.object({
    page: z.number().min(1),
    limit: z.number().min(1),
    total: z.number().min(0),
  }),
});

const successResponseSchema = z.object({
  message: z.string(),
  book: bookResponseSchema,
});

const app = new H3();

// Register route plugins with real Zod validation
app.register(
  defineRoute({
    method: "GET",
    route: "/health",
    handler: async (_event) => {
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      };
    },
  }),
);

app.register(
  defineRoute({
    method: "GET",
    route: "/api/books",
    queryParams: bookQuerySchema,
    output: booksListResponseSchema, // Validate response structure
    meta: { cache: "5m", public: true },
    handler: async (event) => {
      // Query params are automatically validated and typed!
      const query = event.context.query || {};

      // Response will be validated against output schema
      return {
        books: [
          {
            id: "123e4567-e89b-12d3-a456-426614174000",
            title: "h3 Guide",
            author: "h3 Team",
            description: "Complete guide to h3 framework",
            publishedAt: "2024-01-15T10:00:00.000Z",
            tags: ["javascript", "framework", "web"],
            createdAt: "2024-01-15T10:00:00.000Z",
          },
          {
            id: "987fcdeb-51a2-43d1-b2e3-987654321000",
            title: "Modern Web APIs",
            author: "Web Developer",
            description: "Comprehensive guide to modern web APIs",
            publishedAt: "2024-02-20T14:30:00.000Z",
            tags: ["api", "web", "javascript"],
            createdAt: "2024-02-20T14:30:00.000Z",
          },
        ],
        pagination: {
          page: query.page || 1,
          limit: query.limit || 10,
          total: 2,
        },
      };
    },
  }),
);

app.register(
  defineRoute({
    method: "POST",
    route: "/api/books",
    input: createBookSchema,
    output: successResponseSchema, // Validate response structure
    meta: { auth: true, rateLimit: 10 },
    handler: async (event) => {
      // Input is automatically validated and typed!
      const bookData = event.context.body;

      // Response will be validated against output schema
      return {
        message: "Book created successfully!",
        book: {
          id: crypto.randomUUID(),
          ...bookData,
          publishedAt: bookData.publishedAt || new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    },
  }),
);

app.register(
  defineRoute({
    method: "GET",
    route: "/api/books/:id",
    routerParams: bookParamsSchema,
    meta: { public: true },
    middleware: [
      async (event, next) => {
        console.log(`Accessing book: ${event.context.params?.id}`);
        return next();
      },
    ],
    handler: async (event) => {
      // Path params are automatically validated and typed!
      const { id } = event.context.params;
      return {
        message: "Book retrieved",
        book: {
          id,
          title: "Sample Book",
          author: "Sample Author",
          publishedAt: "2024-01-01T00:00:00.000Z",
        },
      };
    },
  }),
);

app.register(
  defineRoute({
    method: "PUT",
    route: "/api/books/:id",
    routerParams: bookParamsSchema,
    input: createBookSchema.partial(), // Allow partial updates
    meta: { auth: true },
    handler: async (event) => {
      const { id } = event.context.params;
      const updates = event.context.body;
      return {
        message: "Book updated successfully",
        book: {
          id,
          ...updates,
          updatedAt: new Date().toISOString(),
        },
      };
    },
  }),
);

app.register(
  defineRoute({
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
      activeUsers: 128,
      systemHealth: "good",
    }),
  }),
);

app.register(
  defineRoute({
    method: "DELETE",
    route: "/admin/books/:id",
    routerParams: bookParamsSchema,
    meta: { auth: true, admin: true },
    handler: async (event) => {
      const { id } = event.context.params;
      return {
        message: `Book ${id} deleted by admin`,
        deletedAt: new Date().toISOString(),
      };
    },
  }),
);

console.log("🚀 h3 server with defineRoute + Zod validation");
console.log("📚 Try these endpoints:");
console.log("  GET  /health");
console.log("  GET  /api/books?page=1&limit=5&search=h3");
console.log("  GET  /api/books/123e4567-e89b-12d3-a456-426614174000");
console.log('  POST /api/books (JSON: {"title": "My Book", "author": "Me"})');
console.log("  PUT  /api/books/123e4567-e89b-12d3-a456-426614174000");
console.log("  GET  /admin/stats");
console.log("  DELETE /admin/books/123e4567-e89b-12d3-a456-426614174000");
console.log("");
console.log("✨ Features demonstrated:");
console.log("  - Plugin-based registration with app.register()");
console.log("  - Real Zod validation with TypeScript types");
console.log("  - Input, output, query, and route parameter validation");
console.log("  - Response structure validation with output schemas");
console.log("  - Route meta (auth, cache, etc.)");
console.log("  - Middleware integration");
console.log("  - Partial updates with Zod .partial()");
console.log("  - Type-safe request/response contracts");

export default app;
