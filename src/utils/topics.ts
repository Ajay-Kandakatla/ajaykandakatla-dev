import { getCollection, type CollectionEntry } from 'astro:content';

export function topicSlug(tag: string): string {
  return tag
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export interface TopicEntry {
  slug: string;
  display: string;
  count: number;
  posts: CollectionEntry<'blog'>[];
}

export async function getAllTopics(): Promise<TopicEntry[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  const map = new Map<string, { display: string; posts: CollectionEntry<'blog'>[] }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = topicSlug(tag);
      if (!map.has(slug)) map.set(slug, { display: tag, posts: [] });
      map.get(slug)!.posts.push(post);
    }
  }
  const out: TopicEntry[] = [];
  for (const [slug, { display, posts: tagPosts }] of map.entries()) {
    out.push({
      slug,
      display,
      count: tagPosts.length,
      posts: tagPosts.sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()),
    });
  }
  out.sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
  return out;
}
