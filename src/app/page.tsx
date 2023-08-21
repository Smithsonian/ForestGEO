import {LoginButton} from "@/app/components/loginbutton";

export default function Home({params,  searchParams, }: {
    params: { slug: string }
    searchParams: { [key: string]: string | string[] | undefined }
}) {
    return (
      <>
        <LoginButton />
          <h1>Home page</h1>
      </>
    );
};