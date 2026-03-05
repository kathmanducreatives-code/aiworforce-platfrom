import { Heart, MessageSquare, ExternalLink, Crosshair } from 'lucide-react';
import type { PostSearchResult } from '@/types/outreach';
import { cn } from '@/lib/utils';

interface PostCardProps {
    post: PostSearchResult;
    onIntercept: (post: PostSearchResult) => void;
    isIntercepting?: boolean;
}

const PostCard = ({ post, onIntercept, isIntercepting }: PostCardProps) => {
    return (
        <div className={cn(
            'group relative flex flex-col gap-4 rounded-2xl border border-border bg-card/60 p-5 backdrop-blur-sm',
            'hover:border-primary/40 hover:shadow-[0_0_24px_-4px_hsl(var(--primary)/0.15)] transition-all duration-300',
        )}>
            {/* Gradient border effect on hover */}
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

            {/* Author */}
            <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                    {post.author_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm leading-tight truncate">{post.author_name}</p>
                    {post.author_headline && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{post.author_headline}</p>
                    )}
                    {post.posted_at && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5">{post.posted_at}</p>
                    )}
                </div>
                {post.post_url && (
                    <a
                        href={post.post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary transition-colors"
                        onClick={e => e.stopPropagation()}
                    >
                        <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                )}
            </div>

            {/* Post snippet */}
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4 flex-1">
                {post.post_snippet}
            </p>

            {/* Engagement stats + CTA */}
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Heart className="h-3.5 w-3.5 text-rose-400" />
                        <span className="tabular-nums">{(post.reactions_count || 0).toLocaleString()}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                        <span className="tabular-nums">{(post.comments_count || 0).toLocaleString()}</span>
                    </span>
                </div>

                <button
                    onClick={() => onIntercept(post)}
                    disabled={isIntercepting}
                    className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                        isIntercepting
                            ? 'bg-primary/20 text-primary/60 cursor-not-allowed'
                            : 'bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_12px_-2px_hsl(var(--primary)/0.5)] active:scale-95'
                    )}
                >
                    <Crosshair className="h-3.5 w-3.5" />
                    {isIntercepting ? 'Intercepting...' : 'Intercept This Post'}
                </button>
            </div>
        </div>
    );
};

export default PostCard;
