---
icon: ph:arrow-right
---

# Validate Data

> Ensure that your data are valid and safe before processing them.

When you receive data on your server, you must validate them. By validate, we mean that the shape of the received data must match the expected shape. It's important because you can't trust the data coming from unknown sources, like a user or an external API.

> [!WARNING]
> Do not use type generics as a validation. Providing an interface to a utility like `readBody` is not a validation. You must validate the data before using it.

## Utilities for Validation

h3 provide some utilities to help you to handle data validation. You will be able to validate:

- query with `getValidatedQuery`
- params with `getValidatedRouterParams`.
- body with `readValidatedBody`

h3 doesn't provide any validation library but it does support schemas coming from a **Standard-Schema** compatible one, like: [Zod](https://zod.dev), [Valibot](https://valibot.dev), [ArkType](https://arktype.io/), etc... (for all compatible libraries please check [their official repository](https://github.com/standard-schema/standard-schema)). If you want to use a validation library that is not compatible with Standard-Schema, you can still use it, but you will have to use parsing functions provided by the library itself (refer to the [Safe Parsing](#safe-parsing) section below).

> [!WARNING]
> h3 is runtime agnostic. This means that you can use it in [any runtime](/adapters). But some validation libraries are not compatible with all runtimes.

Let's see how to validate data with [Zod](https://zod.dev) and [Valibot](https://valibot.dev).

### Validate Params

You can use `getValidatedRouterParams` to validate params and get the result, as a replacement of `getRouterParams`:

```js
import { getValidatedRouterParams } from "h3";
import * as z from 'zod';
import * as v from 'valibot';

// Example with Zod
const contentSchema = z.object({
  topic: z.string().min(1),
  uuid: z.string().uuid(),
});
// Example with Valibot
const contentSchema = v.object({
  topic: v.pipe(v.string(), v.nonEmpty()),
  uuid: v.pipe(v.string(), v.uuid()),
});

router.use(
  // You must use a router to use params
  "/content/:topic/:uuid",
  async (event) => {
    const params = await getValidatedRouterParams(event, contentSchema);
    return `You are looking for content with topic "${params.topic}" and uuid "${params.uuid}".`;
  },
);
```

If you send a valid request like `/content/posts/123e4567-e89b-12d3-a456-426614174000` to this event handler, you will get a response like this:

```txt
You are looking for content with topic "posts" and uuid "123e4567-e89b-12d3-a456-426614174000".
```

If you send an invalid request and the validation fails, h3 will throw a `400 Validation Error` error. In the data of the error, you will find the validation errors you can use on your client to display a nice error message to your user.

### Validate Query

You can use `getValidatedQuery` to validate query and get the result, as a replacement of `getQuery`:

```js
import { getValidatedQuery } from "h3";
import * as z from 'zod';
import * as v from 'valibot';

// Example with Zod
const stringToNumber = z
  .string()
  .regex(/^\d+$/, 'Must be a number string')
  .transform(Number);
const paginationSchema = z.object({
  page: stringToNumber.optional().default(1),
  size: stringToNumber.optional().default(10),
});

// Example with Valibot
const stringToNumber = v.pipe(
  v.string(),
  v.regex(/^\d+$/, 'Must be a number string'),
  v.transform(Number),
)
const paginationSchema = v.object({
  page: v.optional(stringToNumber, 1),
  size: v.optional(stringToNumber, 10),
});

app.use(async (event) => {
  const query = await getValidatedQuery(event, paginationSchema);
  return `You are on page ${query.page} with ${query.size} items per page.`;
});
```

As you may have noticed, compared to the `getValidatedRouterParams` example, we can leverage validation libraries to transform the incoming data. In this case, we transform the string representation of a number into a real number, which is useful for things like content pagination.

If you send a valid request like `/?page=2&size=20` to this event handler, you will get a response like this:

```txt
You are on page 2 with 20 items per page.
```

If you send an invalid request and the validation fails, h3 will throw a `400 Validation Error` error. In the data of the error, you will find the validation errors you can use on your client to display a nice error message to your user.

### Validate Body

You can use `readValidatedBody` to validate body and get the result, as a replacement of `readBody`:

```js
import { readValidatedBody } from "h3";
import { z } from "zod";
import * as v from 'valibot';

// Example with Zod
const userSchema = z.object({
  name: z.string().min(3).max(20),
  age: z.number({ coerce: true }).positive().int(),
});

// Example with Valibot
const userSchema = v.object({
  name: v.pipe(v.string(), v.minLength(3), v.maxLength(20)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

app.use(async (event) => {
  const body = await readValidatedBody(event, userSchema);
  return `Hello ${body.name}! You are ${body.age} years old.`;
});
```

If you send a valid POST request with a JSON body like this:

```json
{
  "name": "John",
  "age": 42
}
```

You will get a response like this:

```txt
Hello John! You are 42 years old.
```

If you send an invalid request and the validation fails, h3 will throw a `400 Validation Error` error. In the data of the error, you will find the validation errors you can use on your client to display a nice error message to your user.

## Safe Parsing

By default if a schema is directly provided as e second argument for each validation utility (`getValidatedRouterParams`, `getValidatedQuery`, and `readValidatedBody`) it will throw a `400 Validation Error` error if the validation fails, but in some cases you may want to handle the validation errors yourself. For this you should provide the actual safe validation function as the second argument, depending on the validation library you are using.

Going back to the first example with `getValidatedRouterParams`, for Zod it would look like this:

```ts
import { getValidatedRouterParams } from "h3";
import { z } from "zod/v4";

const contentSchema = z.object({
  topic: z.string().min(1),
  uuid: z.string().uuid(),
});

router.use(
  "/content/:topic/:uuid",
  async (event) => {
    const params = await getValidatedRouterParams(event, contentSchema.safeParse);
    if (!params.success) {
      // Handle validation errors
      return `Validation failed:\n${z.prettifyError(params.error)}`
    }
    return `You are looking for content with topic "${params.data.topic}" and uuid "${params.data.uuid}".`;
  },
);
```

And for Valibot, it would look like this:

```ts
import { getValidatedRouterParams } from "h3";
import * as v from 'valibot';

const contentSchema = v.object({
  topic: v.pipe(v.string(), v.nonEmpty()),
  uuid: v.pipe(v.string(), v.uuid()),
});

router.use(
  "/content/:topic/:uuid",
  async (event) => {
    const params = await getValidatedRouterParams(event, v.safeParser(contentSchema))
    if (!params.success) {
      // Handle validation errors
      return `Validation failed:\n${v.summarize(params.issues)}`
    }
    return `You are looking for content with topic "${params.output.topic}" and uuid "${params.output.uuid}".`;
  },
);
```
