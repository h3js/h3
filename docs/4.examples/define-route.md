---
icon: ph:arrow-right
---

# Define Route

> A structured approach to route definition with optional type safety, validation, and seamless h3 integration through plugins.

The `defineRoute` function provides a consistent, type-safe way to define routes in h3. It returns a plugin that automatically registers the route, making it simple and compatible with existing h3 patterns while offering powerful validation capabilities.

## Why defineRoute?

In modern applications, you often need:

- **Type safety** for route parameters and request bodies
- **Consistent validation** across all endpoints
- **Route metadata** for authentication, caching, rate limiting
- **Middleware integration** for cross-cutting concerns
- **Better developer experience** with IntelliSense and error checking
- **Modular route registration** with automatic plugin integration

## Basic Usage

Start simple - `defineRoute` works without any validation schemas:

```js
import { H3, defineRoute } from "h3";

const healthRoutePlugin = defineRoute({
  method: "GET",
  route: "/health",
  handler: async (event) => {
    return { status: "ok", timestamp: new Date().toISOString() };
  },
});

const app = new H3();
app.register(healthRoutePlugin);
```

## Enhanced Features

### Validation Schemas

Add automatic validation for request data:

```js
import { z } from "zod";

const createUserRoutePlugin = defineRoute({
  method: "POST",
  route: "/api/users",

  // Validate request body with real Zod schema
  input: z.object({
    email: z.string().email("Invalid email format"),
    name: z.string().min(2, "Name must be at least 2 characters"),
    age: z.number().min(18, "Must be at least 18 years old").max(120),
    role: z.enum(["admin", "user", "moderator"]).default("user"),
  }),

  handler: async (event) => {
    // Body is automatically validated and typed!
    const userData = event.context.body;
    return {
      message: "User created successfully!",
      user: {
        id: crypto.randomUUID(),
        ...userData,
        createdAt: new Date().toISOString(),
      },
    };
  },
});

app.register(createUserRoutePlugin);
```

### Route Meta & Middleware

Integrate with h3's native meta and middleware systems:

```js
const protectedRoutePlugin = defineRoute({
  method: "GET",
  route: "/api/admin/users",

  // Route metadata
  meta: {
    auth: true,
    roles: ["admin"],
    rateLimit: 100,
  },

  // Route-specific middleware
  middleware: [
    async (event, next) => {
      console.log(`Admin access: ${event.url.pathname}`);
      return next();
    },
  ],

  handler: async (event) => {
    // Meta is accessible in any middleware:
    // event.context.matchedRoute?.meta
    return { users: [] };
  },
});

app.register(protectedRoutePlugin);
```

## Step-by-Step Migration

### Step 1: Start with your existing handler

```js
// Your existing h3 handler
app.get("/api/books", async (event) => {
  return { books: [] };
});
```

### Step 2: Convert to defineRoute plugin

```js
const booksRoutePlugin = defineRoute({
  method: "GET",
  route: "/api/books",
  handler: async (event) => {
    return { books: [] };
  },
});

app.register(booksRoutePlugin);
```

### Step 3: Add features incrementally

```js
import { z } from "zod";

const booksRoutePlugin = defineRoute({
  method: "GET",
  route: "/api/books",

  // Add query validation with type coercion
  queryParams: z.object({
    page: z
      .string()
      .transform((val) => parseInt(val, 10))
      .refine((val) => val > 0, "Page must be positive")
      .optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .refine((val) => val > 0 && val <= 100, "Limit must be 1-100")
      .optional(),
    search: z.string().min(1, "Search term cannot be empty").optional(),
    sortBy: z.enum(["title", "author", "publishedAt"]).default("title"),
  }),

  // Add metadata
  meta: { public: true, cache: "5m" },

  handler: async (event) => {
    const { page = 1, limit = 10, search, sortBy } = event.context.query || {};

    return {
      books: [
        { id: "1", title: "h3 Guide", author: "Team" },
        { id: "2", title: "Web APIs", author: "Developer" },
      ].filter(
        (book) =>
          !search || book.title.toLowerCase().includes(search.toLowerCase()),
      ),
      pagination: { page, limit, sortBy },
    };
  },
});

app.register(booksRoutePlugin);
```

## Real-World Examples

### API with Complete Validation

```js
import { z } from "zod";

const updateBookRoutePlugin = defineRoute({
  method: "PUT",
  route: "/api/books/:bookId",

  // Path validation with detailed error messages
  routerParams: z.object({
    bookId: z.string().uuid("Invalid book ID format"),
  }),

  // Query validation with type transformations
  queryParams: z.object({
    notify: z
      .string()
      .transform((val) => val === "true")
      .optional(),
    reason: z
      .string()
      .min(1, "Reason cannot be empty")
      .max(500, "Reason too long")
      .optional(),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "Invalid version format")
      .optional(),
  }),

  // Body validation with conditional fields
  input: z
    .object({
      title: z
        .string()
        .min(1, "Title is required")
        .max(200, "Title too long")
        .optional(),
      description: z.string().max(2000, "Description too long").optional(),
      publishedAt: z.string().datetime("Invalid datetime format").optional(),
      tags: z.array(z.string().min(1)).max(10, "Too many tags").optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
    })
    .refine(
      (data) => Object.keys(data).length > 0,
      "At least one field must be provided for update",
    ),

  // Metadata for your middleware
  meta: {
    auth: true,
    permissions: ["books.write"],
    rateLimit: 20,
  },

  handler: async (event) => {
    // Everything is validated and typed!
    const { bookId } = event.context.params;
    const updates = event.context.body;
    const { notify, reason } = event.context.query || {};

    return {
      message: "Book updated successfully",
      bookId,
      updatedFields: Object.keys(updates),
      notificationSent: notify || false,
      updateReason: reason,
      updatedAt: new Date().toISOString(),
    };
  },
});

app.register(updateBookRoutePlugin);
```

### Global Middleware Integration

```js
const app = new H3();

// Global middleware can read route meta
app.use((event) => {
  const meta = event.context.matchedRoute?.meta;
  if (meta?.auth) {
    // Check authentication
    console.log("Auth required for this route");
  }
  if (meta?.rateLimit) {
    // Apply rate limiting
    console.log(`Rate limit: ${meta.rateLimit}/minute`);
  }
});

// Register route plugins
const publicRoutePlugin = defineRoute({
  method: "GET",
  route: "/public",
  meta: { public: true },
  handler: () => "Public endpoint",
});

const protectedRoutePlugin = defineRoute({
  method: "GET",
  route: "/protected",
  meta: { auth: true, rateLimit: 10 },
  handler: () => "Protected endpoint",
});

app.register(publicRoutePlugin);
app.register(protectedRoutePlugin);
```

## Multiple Routes Registration

You can register multiple routes at once or organize them by feature:

```js
import { z } from "zod";

// Shared schemas for consistency
const userSchema = z.object({
  email: z.string().email("Invalid email format"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  role: z.enum(["admin", "user", "moderator"]).default("user"),
  avatar: z.string().url().optional(),
});

const userParamsSchema = z.object({
  id: z.string().uuid("Invalid user ID format"),
});

const userQuerySchema = z.object({
  page: z
    .string()
    .transform((val) => parseInt(val, 10))
    .optional(),
  role: z.enum(["admin", "user", "moderator"]).optional(),
  search: z.string().min(1).optional(),
});

// Feature-based organization
const userRoutes = [
  defineRoute({
    method: "GET",
    route: "/api/users",
    queryParams: userQuerySchema,
    meta: { auth: true },
    handler: (event) => {
      const { page = 1, role, search } = event.context.query || {};
      return {
        users: [
          {
            id: "123e4567-e89b-12d3-a456-426614174000",
            name: "John",
            email: "john@example.com",
            role: "admin",
          },
          {
            id: "987fcdeb-51a2-43d1-b2e3-987654321000",
            name: "Jane",
            email: "jane@example.com",
            role: "user",
          },
        ].filter(
          (user) =>
            (!role || user.role === role) &&
            (!search || user.name.toLowerCase().includes(search.toLowerCase())),
        ),
        pagination: { page, total: 2 },
      };
    },
  }),
  defineRoute({
    method: "POST",
    route: "/api/users",
    input: userSchema,
    meta: { auth: true, rateLimit: 10 },
    handler: (event) => {
      const userData = event.context.body;
      return {
        message: "User created successfully",
        user: {
          id: crypto.randomUUID(),
          ...userData,
          createdAt: new Date().toISOString(),
        },
      };
    },
  }),
  defineRoute({
    method: "GET",
    route: "/api/users/:id",
    routerParams: userParamsSchema,
    meta: { auth: true },
    handler: (event) => {
      const { id } = event.context.params;
      return {
        user: {
          id,
          name: "John Doe",
          email: "john@example.com",
          role: "admin",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      };
    },
  }),
  defineRoute({
    method: "PUT",
    route: "/api/users/:id",
    routerParams: userParamsSchema,
    input: userSchema.partial(),
    meta: { auth: true },
    handler: (event) => {
      const { id } = event.context.params;
      const updates = event.context.body;
      return {
        message: "User updated successfully",
        user: { id, ...updates, updatedAt: new Date().toISOString() },
      };
    },
  }),
];

// Register all user routes
userRoutes.forEach((plugin) => app.register(plugin));
```

## Benefits

1. **Automatic Registration**: Plugin-based approach eliminates manual route registration
2. **Modular Organization**: Group related routes as plugins
3. **Type Safety**: Full TypeScript support with schema libraries
4. **Consistent API**: Same pattern across all routes
5. **Rich Metadata**: Support for auth, caching, rate limiting, etc.
6. **Middleware Ready**: Easy integration with route-specific middleware
7. **Developer Experience**: Better IntelliSense and error checking

## Schema Libraries

`defineRoute` works with any [Standard Schema](https://github.com/standard-schema/standard-schema) compatible library:

- ✅ [Zod](https://zod.dev)
- ✅ [Valibot](https://valibot.dev)
- ✅ [ArkType](https://arktype.io)
- ✅ And more...

## Migration from GitHub Issue #1088

This implementation addresses the [original feature request](https://github.com/h3js/h3/issues/1088) with:

- ✅ Structured route definitions
- ✅ StandardSchema support for validation
- ✅ Type inference and code consistency
- ✅ Plugin-based modular registration
- ✅ Backward compatibility with existing routes

## Feedback & Discussion

This feature is actively being developed based on community feedback. Please:

- 💬 Share your experience using `defineRoute`
- 🐛 Report any issues you encounter
- 💡 Suggest improvements or additional features
- ⭐ Let us know what works well!

> **Note**: This feature is designed to be backward compatible. Your existing h3 routes will continue to work unchanged.

## Next Steps

1. Try `defineRoute` in your h3 project
2. Gradually convert existing routes to plugin-based registration
3. Add validation to your most critical routes
4. Explore meta and middleware integration
5. Share your feedback with the h3 community

The goal is to make h3 even more powerful while keeping it simple and approachable for everyone!

### Output Schema Validation

You can also validate your response data using output schemas:

```js
import { z } from "zod";

// Define response schemas
const userResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "user", "moderator"]),
  createdAt: z.string().datetime(),
  avatar: z.string().url().optional(),
});

const usersListResponseSchema = z.object({
  users: z.array(userResponseSchema),
  pagination: z.object({
    page: z.number().min(1),
    limit: z.number().min(1),
    total: z.number().min(0),
    hasMore: z.boolean(),
  }),
  filters: z
    .object({
      role: z.enum(["admin", "user", "moderator"]).optional(),
      search: z.string().optional(),
    })
    .optional(),
});

const getUsersRoutePlugin = defineRoute({
  method: "GET",
  route: "/api/users",
  queryParams: z.object({
    page: z
      .string()
      .transform((val) => parseInt(val, 10))
      .optional(),
    limit: z
      .string()
      .transform((val) => parseInt(val, 10))
      .optional(),
    role: z.enum(["admin", "user", "moderator"]).optional(),
    search: z.string().min(1).optional(),
  }),
  output: usersListResponseSchema, // Validate response structure
  meta: { auth: true, cache: "1m" },

  handler: async (event) => {
    const { page = 1, limit = 10, role, search } = event.context.query || {};

    // Your business logic here
    const users = [
      {
        id: "123e4567-e89b-12d3-a456-426614174000",
        name: "John Doe",
        email: "john@example.com",
        role: "admin",
        createdAt: "2024-01-15T10:00:00.000Z",
        avatar: "https://example.com/avatar.jpg",
      },
      {
        id: "987fcdeb-51a2-43d1-b2e3-987654321000",
        name: "Jane Smith",
        email: "jane@example.com",
        role: "user",
        createdAt: "2024-02-20T14:30:00.000Z",
      },
    ];

    // Response will be automatically validated against output schema
    return {
      users: users.filter(
        (user) =>
          (!role || user.role === role) &&
          (!search || user.name.toLowerCase().includes(search.toLowerCase())),
      ),
      pagination: {
        page,
        limit,
        total: users.length,
        hasMore: page * limit < users.length,
      },
      filters: { role, search },
    };
  },
});

app.register(getUsersRoutePlugin);
```

### API Documentation Generation

Output schemas are particularly useful for generating API documentation:

```js
import { z } from "zod";

// Error response schema
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
  timestamp: z.string().datetime(),
  path: z.string(),
});

// Success response with generic data
const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    timestamp: z.string().datetime(),
  });

const createBookRoutePlugin = defineRoute({
  method: "POST",
  route: "/api/books",
  input: z.object({
    title: z.string().min(1, "Title is required"),
    author: z.string().min(1, "Author is required"),
    isbn: z.string().regex(/^\d{13}$/, "Invalid ISBN format"),
    publishedAt: z.string().datetime().optional(),
  }),
  output: successResponseSchema(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      author: z.string(),
      isbn: z.string(),
      publishedAt: z.string().datetime(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
  ),
  meta: {
    auth: true,
    rateLimit: 5,
    description: "Create a new book",
    tags: ["books", "crud"],
  },

  handler: async (event) => {
    const bookData = event.context.body;

    // Your book creation logic
    const newBook = {
      id: crypto.randomUUID(),
      ...bookData,
      publishedAt: bookData.publishedAt || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Response matches output schema structure
    return {
      success: true,
      data: newBook,
      timestamp: new Date().toISOString(),
    };
  },
});

app.register(createBookRoutePlugin);
```
