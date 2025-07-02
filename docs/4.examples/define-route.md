---
icon: ph:arrow-right
---

# Define Route

> A structured approach to route definition with optional type safety, validation, and seamless h3 integration.

The `defineRoute` function provides a consistent, type-safe way to define routes in h3. It's designed to be simple and compatible with existing h3 patterns while offering powerful validation capabilities.

## Why defineRoute?

In modern applications, you often need:

- **Type safety** for route parameters and request bodies
- **Consistent validation** across all endpoints
- **Route metadata** for authentication, caching, rate limiting
- **Middleware integration** for cross-cutting concerns
- **Better developer experience** with IntelliSense and error checking
- **Seamless integration** with schema libraries like Zod, Valibot, etc.

## Basic Usage

Start simple - `defineRoute` works without any validation schemas:

```js
import { H3, defineRoute } from "h3";

const healthRoute = defineRoute({
  method: "GET",
  route: "/health",
  handler: async (event) => {
    return { status: "ok", timestamp: new Date().toISOString() };
  },
});

const app = new H3();
app.on(
  healthRoute.method,
  healthRoute.route,
  healthRoute.handler,
  healthRoute.options,
);
```

## Enhanced Features

### Validation Schemas

Add automatic validation for request data:

```js
import { z } from "zod";

const createUserRoute = defineRoute({
  method: "POST",
  route: "/api/users",

  // Validate request body
  input: z.object({
    email: z.string().email(),
    name: z.string().min(2),
    age: z.number().min(18),
  }),

  handler: async (event) => {
    // Body is automatically validated!
    return { message: "User created successfully!" };
  },
});
```

### Route Meta & Middleware

Integrate with h3's native meta and middleware systems:

```js
const protectedRoute = defineRoute({
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
```

## Step-by-Step Migration

### Step 1: Start with your existing handler

```js
// Your existing h3 handler
app.get("/api/books", async (event) => {
  return { books: [] };
});
```

### Step 2: Convert to defineRoute

```js
const booksRoute = defineRoute({
  method: "GET",
  route: "/api/books",
  handler: async (event) => {
    return { books: [] };
  },
});

app.on(
  booksRoute.method,
  booksRoute.route,
  booksRoute.handler,
  booksRoute.options,
);
```

### Step 3: Add features incrementally

```js
const booksRoute = defineRoute({
  method: "GET",
  route: "/api/books",

  // Add query validation
  queryParams: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
  }),

  // Add metadata
  meta: { public: true, cache: "5m" },

  handler: async (event) => {
    return { books: [] };
  },
});
```

## Real-World Examples

### API with Complete Validation

```js
const updateBookRoute = defineRoute({
  method: "PUT",
  route: "/api/books/:bookId",

  // Path validation
  routerParams: z.object({
    bookId: z.string().uuid(),
  }),

  // Query validation
  queryParams: z.object({
    notify: z.boolean().optional(),
    reason: z.string().optional(),
  }),

  // Body validation
  input: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    publishedAt: z.date().optional(),
  }),

  // Metadata for your middleware
  meta: {
    auth: true,
    permissions: ["books.write"],
  },

  handler: async (event) => {
    // Everything is validated and typed!
    return { message: "Book updated successfully" };
  },
});
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

// Register routes
const publicRoute = defineRoute({
  method: "GET",
  route: "/public",
  meta: { public: true },
  handler: () => "Public endpoint",
});

const protectedRoute = defineRoute({
  method: "GET",
  route: "/protected",
  meta: { auth: true, rateLimit: 10 },
  handler: () => "Protected endpoint",
});

app.on(
  publicRoute.method,
  publicRoute.route,
  publicRoute.handler,
  publicRoute.options,
);
app.on(
  protectedRoute.method,
  protectedRoute.route,
  protectedRoute.handler,
  protectedRoute.options,
);
```

## Registration Methods

You have two ways to register routes:

### Method 1: Manual registration (Recommended)

```js
const route = defineRoute({
  method: "GET",
  route: "/api/users",
  handler: () => ({ users: [] }),
});

app.on(route.method, route.route, route.handler, route.options);
```

### Method 2: createService (alias)

For teams familiar with service-oriented patterns, `createService` provides the exact same functionality:

```js
import { createService } from "h3";

const userService = createService({
  method: "GET",
  route: "/api/users",
  meta: { service: "user" },
  handler: async (event) => {
    return { users: [] };
  },
});

app.on(
  userService.method,
  userService.route,
  userService.handler,
  userService.options,
);
```

## Benefits

1. **Seamless Integration**: Works perfectly with h3's existing systems
2. **Gradual Adoption**: Start without validation, add features when needed
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
2. Gradually add validation to your most critical routes
3. Explore meta and middleware integration
4. Share your feedback with the h3 community
5. Help us improve the developer experience

The goal is to make h3 even more powerful while keeping it simple and approachable for everyone!
