import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";

export const New = () => (
    <>
        <h1>New Plant Form</h1>
        <QuadratMetadataEntryForm />
        <QuadratDataEntryForm />
    </>
);

New.defaultName = 'New';