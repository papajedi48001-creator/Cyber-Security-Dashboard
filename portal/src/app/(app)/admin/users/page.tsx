import { redirect } from "next/navigation";

/** Old address of the user page, kept for bookmarks. */
export default function OldUsersPage() {
  redirect("/settings/users");
}
