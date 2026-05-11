import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverUrl: z.string().url().optional(),
      coverAlt: z.string().optional(),
      draft: z.boolean().default(false),
      crossPost: z
        .object({
          hashnode: z.boolean().default(false),
          substack: z.boolean().default(false),
          devto: z.boolean().default(false),
        })
        .default({ hashnode: false, substack: false, devto: false }),
    }),
});

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    year: z.number(),
    stack: z.array(z.string()).default([]),
    href: z.string().url().optional(),
    repo: z.string().url().optional(),
    order: z.number().default(0),
  }),
});

export const collections = { blog, projects };
