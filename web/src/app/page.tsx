import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/guard";

export default async function Home() {
  redirect((await currentSession()) ? "/labs" : "/sign-in");
}
