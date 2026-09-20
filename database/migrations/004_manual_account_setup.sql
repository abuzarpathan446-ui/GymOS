-- Manual setup links do not establish ownership of an email address.
ALTER TABLE access_tokens DROP CONSTRAINT access_tokens_purpose_check;
ALTER TABLE access_tokens ADD CONSTRAINT access_tokens_purpose_check CHECK(purpose IN ('RESET','INVITE','VERIFY','SETUP'));
