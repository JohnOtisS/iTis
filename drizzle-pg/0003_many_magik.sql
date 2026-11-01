ALTER TABLE "image_generations" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "image_generations" ADD COLUMN "stage" text DEFAULT 'Đang xếp hàng' NOT NULL;--> statement-breakpoint
ALTER TABLE "image_generations" ADD COLUMN "external_job_id" text;--> statement-breakpoint
UPDATE "image_generations" SET "progress" = 100, "stage" = 'Hoàn thành' WHERE "status" = 'completed';--> statement-breakpoint
UPDATE "image_generations" SET "stage" = 'Tạo ảnh thất bại' WHERE "status" = 'failed';
