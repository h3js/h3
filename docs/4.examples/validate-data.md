---
icon: ph:arrow-right
---

# Validate Data

> Ensure that your data are valid and safe before processing them.

When you receive data from user on your server, you must validate them. By validate, we mean that the shape of the received data must match the expected shape. It's important because you can't trust user input.

> [!WARNING]
> Do not use a generic as a validation. Providing an interface to a utility like `readJSONBody` is not a validation. You must validate the data before using them.

## Utilities for Validation

h3 provide some utilities to help you to handle data validation. You will be able to validate:

- query with `getValidatedQuery`
- params with `getValidatedRouterParams`.
- body with `readValidatedJSONBody`

To validate data, you can use any validation library you want. h3 doesn't provide any validation library like [Zod](https://zod.dev), [joi](https://joi.dev) or [myzod](https://github.com/davidmdm/myzod).

> [!WARNING]
> h3 is runtime agnostic. This means that you can use it in [any runtime](/adapters). But some validation libraries are not compatible with all runtimes.

Let's see how to validate data with [Zod](https://zod.dev).

For the following examples, we will use the following schema:

```js
import { z } from "zod";

const userSchema = z.object({
  name: z.string().min(3).max(20),
  age: z.number({ coerce: true }).positive().int(),
});
```

## Validate Query

You can use `getValidatedQuery` to validate query and get the result, as a replacement of `getQuery`:

```js
import { getValidatedQuery } from "h3";

app.use(async (event) => {
  const query = await getValidatedQuery(event, userSchema.parse);
  return `Hello ${query.name}! You are ${query.age} years old.`;
});
```

> [!NOTE]
> You could use `safeParse` instead of `parse` to get a partial query object and to not throw an error if the query is invalid.

If you send a valid request like `/?name=John&age=42` to this event handler, you will get a response like this:

```txt
Hello John! You are 42 years old.
```

If you send an invalid request and the validation fails, h3 will throw a `400 Validation Error` error. In the data of the error, you will find the validation errors you can use on your client to display a nice error message to your user.

## Validate Params

You can use `getValidatedRouterParams` to validate params and get the result, as a replacement of `getRouterParams`:

```js
import { getValidatedRouterParams } from "h3";

router.use(
  // You must use a router to use params
  "/hello/:name/:age",
  async (event) => {
    const params = await getValidatedRouterParams(event, userSchema.parse);
    return `Hello ${params.name}! You are ${params.age} years old!`;
  },
);
```

> [!NOTE]
> You could use `safeParse` instead of `parse` to get a partial params object and to not throw an error if the params is invalid.

If you send a valid request like `/hello/John/42` to this event handler, you will get a response like this:

```txt
Hello John! You are 42 years old.
```

If you send an invalid request and the validation fails, h3 will throw a `400 Validation Error` error. In the data of the error, you will find the validation errors you can use on your client to display a nice error message to your user.

## Validate Body

You can use `readValidatedJSONBody` to validate body and get the result, as a replacement of `readJSONBody`:

```js
import { readValidatedJSONBody } from "h3";

app.use(async (event) => {
  const body = await readValidatedJSONBody(event, userSchema.parse);
  return `Hello ${body.name}! You are ${body.age} years old.`;
});
```

> [!NOTE]
> You could use `safeParse` instead of `parse` to get a partial body object and to not throw an error if the body is invalid.

If you send a valid POST request to this event handler, you will get a response like this:

```txt
Hello John! You are 42 years old.
```

If you send an invalid request and the validation fails, h3 will throw a `400 Validation Error` error. In the data of the error, you will find the validation errors you can use on your client to display a nice error message to your user.
