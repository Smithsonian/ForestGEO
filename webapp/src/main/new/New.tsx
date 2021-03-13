import { useState } from 'react';

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { Quadrat, Stem } from '../../types';

export const New = () => {
    const quadrats: Quadrat[] = [
        {
            id: 'Quadrat 1',
            subquadrats: [ {
                id: 'q1s1',
                trees: [
                    {
                        tag: 1,
                        stems: []
                    },
                    {
                        tag: 2,
                        stems: []
                    }
                ]
            }]
        },
        {
            id: 'Quadrat 2',
            subquadrats: [ {
                id: 'q2s1',
                trees: [
                    {
                        tag: 1,
                        stems: []
                    }
                ]
            }]
        }
    ];
    const [errors, setErrors] = useState<any>([]);
    const [selectedQuadrat, setSelectedQuadrat] = useState(quadrats[0]);

    const hardCodedFormData: Stem[] = [
        {
          "Subquadrat":"11",
          "Tag":1,
          "StemTag":1,
          "SpCode":"species",
          "DBH":10,
          "Codes":"at",
          "Comments":""
        },
        {
          "Subquadrat":"11",
          "Tag":2,
          "StemTag":1,
          "SpCode":"species",
          "DBH":10,
          "Codes":"at",
          "Comments":""
        }
      ];

    const [formData, setFormData] = useState(hardCodedFormData);
    return (
        <>
            <h1>New Plant Form</h1>
            <QuadratMetadataEntryForm quadrats={quadrats} />
            <QuadratDataEntryForm quadrat={selectedQuadrat} setFormData={setFormData} />
            <button onClick={() => {
                // handle form submission
                fetch('https://treedataapi.azurewebsites.net/api/treedata?code=ruBIe/cx1E6tB6s1Foa4iq7SwDBuXprPzg55d1m786pMjUrB4ePraQ==', { method: 'POST', body: JSON.stringify(formData)})
                .then(response => response.json())
                    .then(errorData => {
                        setErrors(errorData)
                    });
            }}>Submit</button>
            <ul>
                {errors.map((error: any) => (
                    <li>There was an error on  the tree branch identified by subquadrat {error.Subquadrat}, tag {error.Tag} and stem {error.StemTag}: {error.Error}</li>
                ))}
            </ul>
        </>
    );
}

New.defaultName = 'New';