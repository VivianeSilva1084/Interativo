-- Reviews are submitted through either the PT or IT section of vendas.html's
-- form, and shown as testimonials on both language sections of the same
-- page - a comment left in one language read verbatim on the other looks
-- unprofessional. Split into one column per language: the submission form
-- writes into whichever matches the section it was submitted through, and
-- the other stays NULL until an admin manually adds a translation (see
-- admin.html's review moderation card) - vendas.html only shows a comment
-- on a given language section once that language's column is filled in.
ALTER TABLE public.app_reviews
  ADD COLUMN comment_pt text,
  ADD COLUMN comment_it text;

-- One-off backfill: every existing review with a comment was submitted in
-- Portuguese (confirmed by reading the actual rows, not assumed) - future
-- inserts write straight into comment_pt/comment_it, never the old column.
UPDATE public.app_reviews SET comment_pt = comment WHERE comment IS NOT NULL;

ALTER TABLE public.app_reviews DROP COLUMN comment;

COMMENT ON COLUMN public.app_reviews.comment_pt IS 'Comentário em português - original se a review foi enviada pelo formulário PT, ou tradução manual do admin se foi enviada em italiano.';
COMMENT ON COLUMN public.app_reviews.comment_it IS 'Comentário em italiano - original se a review foi enviada pelo formulário IT, ou tradução manual do admin se foi enviada em português.';
