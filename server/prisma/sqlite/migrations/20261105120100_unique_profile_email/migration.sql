-- Email is an account identity and must be unique across concurrent sign-ups.
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");
