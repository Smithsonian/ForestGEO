import Login from "@/app/(endpoints)/login/page";

export default function Home({params, searchParams,}: {
  params: { slug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  return (
    <>
      <Login />
    </>
  );
};