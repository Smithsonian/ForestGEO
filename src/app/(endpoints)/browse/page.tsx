export default function Browse({params,  searchParams, }: {
    params: { slug: string }
    searchParams: { [key: string]: string | string[] | undefined }
}) {
    return <h1>Browsing page</h1>;
}