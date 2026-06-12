import { isValidElement, type ReactNode, useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import {
  type BlogPost,
  BlogPostNotFoundError,
  fetchBlogBody,
  fetchBlogPost,
  fetchBlogPosts,
} from "../../../api/marketing/blog";
import { Avatar } from "../../../components/Avatar/Avatar";
import styles from "./BlogView.module.css";

const MD_REMARK = [remarkGfm];
const MD_REHYPE = [rehypeHighlight];

function formatDate(value: string | null, language: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(language, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

/**
 * Stable, deterministic heading slug. Used both to build the table of
 * contents from the raw markdown and to assign matching `id`s to the
 * rendered headings, so anchor clicks resolve. Intentionally has no
 * de-duplication so the two call sites always agree on the same id for a
 * given heading text.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Recursively flattens rendered markdown children into plain text. */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

interface TocItem {
  readonly depth: number;
  readonly text: string;
  readonly id: string;
}

/**
 * Parse top-level (`#`) and second-level (`##`) markdown headings into a
 * flat table of contents, skipping fenced code blocks so `# comment`
 * lines inside ``` blocks aren't mistaken for headings.
 */
function buildToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,2})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    items.push({ depth: match[1].length, text, id: slugify(text) });
  }
  return items;
}

function ExternalLink(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement>,
): React.ReactElement {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function HeadingWithId(
  Tag: "h1" | "h2" | "h3",
): (props: { children?: ReactNode }) => React.ReactElement {
  return function Heading({ children }): React.ReactElement {
    return <Tag id={slugify(extractText(children))}>{children}</Tag>;
  };
}

const MD_COMPONENTS: Components = {
  a: ExternalLink,
  h1: HeadingWithId("h1"),
  h2: HeadingWithId("h2"),
  h3: HeadingWithId("h3"),
};

function PostByline({ post }: { post: BlogPost }): React.ReactElement {
  const { t } = useTranslation("marketing");
  return (
    <div className={styles.byline}>
      <Avatar
        type="user"
        size={28}
        avatarUrl={post.authorAvatarUrl ?? undefined}
        name={post.authorName ?? undefined}
      />
      <span className={styles.bylineText}>
        {post.authorName ? (
          <span className={styles.bylineName}>{post.authorName}</span>
        ) : null}
        <span className={styles.bylineReadTime}>
          {t("blog.readTime", {
            defaultValue: `${post.readTimeMinutes} min read`,
            count: post.readTimeMinutes,
          })}
        </span>
      </span>
    </div>
  );
}

/**
 * Drop the leading H1 (and an immediately-following italic-only meta line,
 * e.g. `_June 4, 2026 · Nightly …_`) from a post body. The page renders the
 * title and date from the post metadata, so a body that repeats them would
 * show the title twice; stripping them lets the reading column open on the
 * intro paragraph (and its drop cap), matching the reference layout.
 */
function stripLeadingTitle(markdown: string): string {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  if (i >= lines.length || !/^#\s+/.test(lines[i].trim())) return markdown;
  i += 1; // drop the H1
  let j = i;
  while (j < lines.length && lines[j].trim() === "") j += 1;
  if (j < lines.length && /^[*_].*[*_]$/.test(lines[j].trim())) {
    i = j + 1; // also drop the italic meta line
  }
  return lines.slice(i).join("\n").replace(/^\n+/, "");
}

function BlogPostCard({ post }: { post: BlogPost }): React.ReactElement {
  const { t, i18n } = useTranslation("marketing");
  return (
    <Link to={`/blog/${post.slug}`} className={styles.card}>
      {post.heroImageUrl ? (
        <div className={styles.cardHeroWrap}>
          <img
            src={post.heroImageUrl}
            alt=""
            className={styles.cardHero}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : null}
      <div className={styles.cardBody}>
        <div className={styles.cardMeta}>
          <span className={styles.cardType}>{post.blogType}</span>
          {post.publishedAt ? (
            <time dateTime={post.publishedAt}>
              {formatDate(post.publishedAt, i18n.language)}
            </time>
          ) : null}
        </div>
        <h2 className={styles.cardTitle}>{post.title}</h2>
        {post.excerpt ? <p className={styles.cardExcerpt}>{post.excerpt}</p> : null}
        <div className={styles.cardBylineRow}>
          <Avatar
            type="user"
            size={24}
            avatarUrl={post.authorAvatarUrl ?? undefined}
            name={post.authorName ?? undefined}
          />
          {post.authorName ? (
            <span className={styles.cardAuthor}>{post.authorName}</span>
          ) : null}
          <span className={styles.cardReadTime}>
            {t("blog.readTime", {
              defaultValue: `${post.readTimeMinutes} min read`,
              count: post.readTimeMinutes,
            })}
          </span>
        </div>
      </div>
    </Link>
  );
}

function PostThumb({
  post,
  className,
}: {
  post: BlogPost;
  className: string;
}): React.ReactElement {
  if (!post.heroImageUrl) {
    return <div className={`${className} ${styles.thumbFallback}`} />;
  }
  return (
    <img
      src={post.heroImageUrl}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
    />
  );
}

function PostMeta({ post }: { post: BlogPost }): React.ReactElement {
  const { i18n } = useTranslation("marketing");
  return (
    <div className={styles.listMeta}>
      <span className={styles.metaType}>{post.blogType}</span>
      {post.publishedAt ? (
        <time dateTime={post.publishedAt}>
          {formatDate(post.publishedAt, i18n.language)}
        </time>
      ) : null}
    </div>
  );
}

/** Large lead post shown first on the index, image beside the summary. */
function FeaturedPost({ post }: { post: BlogPost }): React.ReactElement {
  return (
    <Link to={`/blog/${post.slug}`} className={styles.featured}>
      <div className={styles.featuredHeroWrap}>
        <PostThumb post={post} className={styles.featuredHero} />
      </div>
      <div className={styles.featuredBody}>
        <h2 className={styles.featuredTitle}>{post.title}</h2>
        {post.excerpt ? (
          <p className={styles.featuredExcerpt}>{post.excerpt}</p>
        ) : null}
        <PostMeta post={post} />
      </div>
    </Link>
  );
}

/** Compact 2-up list row: square thumbnail beside the title + meta. */
function BlogListItem({ post }: { post: BlogPost }): React.ReactElement {
  return (
    <Link to={`/blog/${post.slug}`} className={styles.listItem}>
      <div className={styles.thumbWrap}>
        <PostThumb post={post} className={styles.thumb} />
      </div>
      <div className={styles.listItemBody}>
        <h3 className={styles.listItemTitle}>{post.title}</h3>
        <PostMeta post={post} />
      </div>
    </Link>
  );
}

/** Full archive of every post as a compact Title / Type / Date table. */
function BlogTable({
  posts,
}: {
  posts: readonly BlogPost[];
}): React.ReactElement {
  const { t, i18n } = useTranslation("marketing");
  return (
    <section
      className={styles.archive}
      aria-label={t("blog.allPosts", { defaultValue: "All posts" })}
    >
      <span className={styles.archiveLabel}>
        {t("blog.allPosts", { defaultValue: "All posts" })}
      </span>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t("blog.table.title", { defaultValue: "Title" })}</th>
            <th scope="col" className={styles.colAuthor}>
              {t("blog.table.author", { defaultValue: "Author" })}
            </th>
            <th scope="col" className={styles.colType}>
              {t("blog.table.type", { defaultValue: "Type" })}
            </th>
            <th scope="col" className={styles.colDate}>
              {t("blog.table.date", { defaultValue: "Date" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <Link to={`/blog/${post.slug}`} className={styles.tableTitleLink}>
                  {post.title}
                </Link>
              </td>
              <td className={styles.colAuthor}>{post.authorName ?? "—"}</td>
              <td className={styles.colType}>
                <span className={styles.tableType}>{post.blogType}</span>
              </td>
              <td className={styles.colDate}>
                {post.publishedAt ? (
                  <time dateTime={post.publishedAt}>
                    {formatDate(post.publishedAt, i18n.language)}
                  </time>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function BlogIndex({
  posts,
  isLoading,
}: {
  posts: readonly BlogPost[];
  isLoading: boolean;
}): React.ReactElement {
  const { t } = useTranslation("marketing");
  const [featured, ...rest] = posts;
  return (
    <div className={styles.indexShell}>
      <header className={styles.indexHeader}>
        <span className={styles.latestLabel}>
          {t("blog.latest", { defaultValue: "Latest" })}
        </span>
      </header>
      {isLoading ? null : posts.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>{t("blog.empty.heading", { defaultValue: "No posts yet." })}</h2>
          <p>
            {t("blog.empty.body", {
              defaultValue:
                "The blog is connected, but no posts have been published yet.",
            })}
          </p>
        </div>
      ) : (
        <>
          {featured ? <FeaturedPost post={featured} /> : null}
          {rest.length > 0 ? (
            <div
              className={styles.listGrid}
              aria-label={t("blog.recentPostsAriaLabel", {
                defaultValue: "Recent posts",
              })}
            >
              {rest.map((post) => (
                <BlogListItem key={post.id} post={post} />
              ))}
            </div>
          ) : null}
          <BlogTable posts={posts} />
        </>
      )}
    </div>
  );
}

function TableOfContents({
  items,
}: {
  items: readonly TocItem[];
}): React.ReactElement | null {
  const { t } = useTranslation("marketing");
  if (items.length === 0) return null;

  const handleClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ): void => {
    const target = document.getElementById(id);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <nav
      className={styles.toc}
      aria-label={t("blog.tocAriaLabel", {
        defaultValue: "Table of contents",
      })}
    >
      <span className={styles.tocLabel}>
        {t("blog.tocTitle", { defaultValue: "Table of Contents" })}
      </span>
      <ul className={styles.tocList}>
        {items.map((item, index) => (
          <li
            key={`${item.id}-${index}`}
            className={styles.tocItem}
            data-depth={item.depth}
          >
            <a href={`#${item.id}`} onClick={(event) => handleClick(event, item.id)}>
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BlogSinglePost({
  post,
  body,
  bodyLoading,
  otherPosts,
}: {
  post: BlogPost;
  body: string;
  bodyLoading: boolean;
  otherPosts: readonly BlogPost[];
}): React.ReactElement {
  const { t, i18n } = useTranslation("marketing");
  const renderedBody = useMemo(() => stripLeadingTitle(body), [body]);
  const toc = useMemo(() => buildToc(renderedBody), [renderedBody]);

  const groupedByType = useMemo(() => {
    const map = new Map<string, BlogPost[]>();
    for (const other of otherPosts) {
      const list = map.get(other.blogType) ?? [];
      list.push(other);
      map.set(other.blogType, list);
    }
    return [...map.entries()];
  }, [otherPosts]);

  return (
    <div className={styles.postShell}>
      <div className={styles.postLayout}>
        <aside
          className={styles.leftRail}
          aria-label={t("blog.navigationAriaLabel", {
            defaultValue: "Blog navigation",
          })}
        >
          <nav
            className={styles.breadcrumb}
            aria-label={t("blog.breadcrumbAriaLabel", {
              defaultValue: "Breadcrumb",
            })}
          >
            <Link to="/blog">{t("blog.title", { defaultValue: "Blog" })}</Link>
            <span aria-hidden="true" className={styles.breadcrumbSep}>
              /
            </span>
            <span className={styles.breadcrumbCurrent}>{post.blogType}</span>
          </nav>

          <div className={styles.prevList}>
            <span className={styles.prevListLabel}>
              {t("blog.morePosts", { defaultValue: "More posts" })}
            </span>
            {otherPosts.length === 0 ? (
              <p className={styles.prevListEmpty}>
                {t("blog.noOtherPosts", { defaultValue: "No other posts yet." })}
              </p>
            ) : (
              <ul>
                {otherPosts.map((other) => (
                  <li key={other.id}>
                    <Link
                      to={`/blog/${other.slug}`}
                      className={styles.prevListLink}
                    >
                      <span className={styles.prevListTitle}>{other.title}</span>
                      {other.publishedAt ? (
                        <time
                          dateTime={other.publishedAt}
                          className={styles.prevListDate}
                        >
                          {formatDate(other.publishedAt, i18n.language)}
                        </time>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <article className={styles.postColumn}>
          {post.publishedAt ? (
            <time className={styles.postDate} dateTime={post.publishedAt}>
              {formatDate(post.publishedAt, i18n.language)}
            </time>
          ) : null}

          <h1 className={styles.postTitle}>{post.title}</h1>

          <PostByline post={post} />

          {post.heroImageUrl ? (
            <div className={styles.postHeroWrap}>
              <img
                src={post.heroImageUrl}
                alt=""
                className={styles.postHero}
                decoding="async"
              />
            </div>
          ) : null}

          <TableOfContents items={toc} />

          <div className={styles.markdownBody}>
            {bodyLoading ? (
              <p className={styles.stateMessage} aria-busy="true">
                {t("blog.loading", { defaultValue: "Loading…" })}
              </p>
            ) : body ? (
              <ReactMarkdown
                remarkPlugins={MD_REMARK}
                rehypePlugins={MD_REHYPE}
                components={MD_COMPONENTS}
              >
                {renderedBody}
              </ReactMarkdown>
            ) : (
              <p className={styles.stateMessage}>
                {t("blog.noContent", {
                  defaultValue: "This post has no content yet.",
                })}
              </p>
            )}
          </div>
        </article>
      </div>

      {groupedByType.length > 0 ? (
        <section
          className={styles.moreSection}
          aria-label={t("blog.moreFromBlog", {
            defaultValue: "More from the blog",
          })}
        >
          <h2 className={styles.moreSectionTitle}>
            {t("blog.moreFromBlog", { defaultValue: "More from the blog" })}
          </h2>
          {groupedByType.map(([type, group]) => (
            <div key={type} className={styles.moreGroup}>
              <h3 className={styles.moreGroupTitle}>{type}</h3>
              <div className={styles.cardGrid}>
                {group.map((other) => (
                  <BlogPostCard key={other.id} post={other} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Public `/blog` site. Renders the index list at `/blog` and a single
 * post at `/blog/:slug` (read via `useParams`). The markdown body is not
 * part of the post JSON, so it's fetched separately from the post's
 * public S3 `bodyUrl` and rendered with the same `react-markdown` stack
 * the app uses for read-only content. Page chrome (titlebar / sidebar /
 * scroll column) is owned by the public-mode `AuraShell` +
 * `PublicMarketingPanel`; `usePublicPageViewed` is fired there.
 */
export function BlogView(): React.ReactElement {
  const { t } = useTranslation("marketing");
  const { slug } = useParams<{ slug?: string }>();

  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ["marketing-blog"],
    queryFn: fetchBlogPosts,
  });

  const {
    data: post,
    isLoading: postLoading,
    error: postError,
  } = useQuery({
    queryKey: ["marketing-blog-post", slug],
    queryFn: () => fetchBlogPost(slug as string),
    enabled: Boolean(slug),
    retry: false,
  });

  const bodyUrl = post?.bodyUrl;
  const { data: body, isLoading: bodyLoading } = useQuery({
    queryKey: ["marketing-blog-body", bodyUrl],
    queryFn: () => fetchBlogBody(bodyUrl as string),
    enabled: Boolean(bodyUrl),
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = post
      ? t("blog.postDocumentTitle", {
          defaultValue: `AURA - ${post.title}`,
          title: post.title,
        })
      : t("blog.documentTitle", { defaultValue: "AURA - Blog" });
    return () => {
      document.title = previousTitle;
    };
  }, [post, t]);

  const allPosts = useMemo<readonly BlogPost[]>(() => posts ?? [], [posts]);

  if (!slug) {
    return (
      <section className={styles.page}>
        <BlogIndex posts={allPosts} isLoading={postsLoading} />
      </section>
    );
  }

  if (postError instanceof BlogPostNotFoundError) {
    return (
      <section className={styles.page}>
        <div className={styles.notFound}>
          <h1>{t("blog.notFound.heading", { defaultValue: "Post not found" })}</h1>
          <p>
            {t("blog.notFound.body", {
              defaultValue:
                "The post you're looking for doesn't exist or isn't published.",
            })}
          </p>
          <Link to="/blog" className={styles.notFoundLink}>
            {t("blog.notFound.backLink", {
              defaultValue: "← Back to the blog",
            })}
          </Link>
        </div>
      </section>
    );
  }

  if (postLoading || !post) {
    return (
      <section className={styles.page}>
        <p className={styles.stateMessage} aria-busy="true">
          {t("blog.loadingPost", { defaultValue: "Loading post…" })}
        </p>
      </section>
    );
  }

  const otherPosts = allPosts.filter((candidate) => candidate.id !== post.id);

  return (
    <section className={styles.page}>
      <BlogSinglePost
        post={post}
        body={body ?? ""}
        bodyLoading={bodyLoading}
        otherPosts={otherPosts}
      />
    </section>
  );
}
