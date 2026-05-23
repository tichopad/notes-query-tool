CREATE TABLE "bases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bases_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_file_path_unique";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "base_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_base_id_file_path_unique" UNIQUE("base_id","file_path");