export default function Home({params, searchParams,}: {
  params: { slug: string }
  searchParams: { [key: string]: string | string[] | undefined }
}) {
  return (
    <>
      <h1>Home page</h1>
    </>
  );
};