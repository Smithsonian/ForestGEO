import { useState } from 'react';

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";

export const New = () => {
    const [errors, setErrors] = useState([]);
    const data: any[] = [];
    return (
        <>
            <h1>New Plant Form</h1>
            <QuadratMetadataEntryForm />
            <QuadratDataEntryForm />
            <button onClick={() => {
                // handle form submission
                fetch('', { method: 'POST', body: JSON.stringify(data)})
                    .then(() => {
                        setErrors([])
                    })
                    .catch(error => {
                        setErrors(error);
                    })
            }}>Submit</button>
            <pre>
                {JSON.stringify(errors, null, 2)}
            </pre>
        </>
    );
}

New.defaultName = 'New';