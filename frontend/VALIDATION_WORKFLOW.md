# Validation System Workflow

## Complete User Journey Flowchart

```mermaid
flowchart TD
    A[User Accesses Validations Page] --> B{User Authentication}
    B -->|Not Admin/Global| C[Access Denied Error]
    B -->|Admin/Global| D[Load Existing Validations]

    D --> E[Display Validations Table]
    E --> F{User Action}

    %% View/Download Existing Validation
    F -->|View Validation| G[Expand Validation Row]
    G --> H[Show SQL Query with Variables Replaced]
    H --> I{User Action on Existing}
    I -->|Download Query| J[Process Query with Parameters]
    J --> K[Generate SQL File]
    K --> L[Download File to User]

    %% Edit Existing Validation
    I -->|Edit Query| M[Enable CodeEditor]
    M --> N[Real-time Validation]
    N --> O{Validation Passes?}
    O -->|No| P[Show Errors/Warnings]
    P --> N
    O -->|Yes| Q[Save Button Available]
    Q --> R[Update Database]
    R --> S[Refresh Validations List]

    %% Create New Validation
    F -->|Add New Validation| T[Show NewValidationRow]
    T --> U{Query Field Empty?}
    U -->|Yes| V[Show 'Use Template' Button]
    V --> W{User Clicks Template?}
    W -->|Yes| X[Load Standard Template]
    W -->|No| Y[User Types Custom Query]
    X --> Z[Template with Core Patterns]
    Y --> Z
    U -->|No| Z

    Z --> AA[Real-time Validation Engine]
    AA --> BB[Schema Validation API]
    BB --> CC[Core Pattern Validation]
    CC --> DD[SQL Syntax Validation]

    DD --> EE{All Validations Pass?}
    EE -->|No| FF[Display Errors/Warnings]
    FF --> GG[User Fixes Issues]
    GG --> AA

    EE -->|Yes| HH[Enable Save Button]
    HH --> II[Generate Unique ValidationID]
    II --> JJ[Insert to Database]
    JJ --> KK[Update UI with New Validation]

    %% Back to main flow
    L --> E
    S --> E
    KK --> E

    %% Styling
    classDef userAction fill:#e1f5fe
    classDef systemProcess fill:#f3e5f5
    classDef validation fill:#fff3e0
    classDef error fill:#ffebee
    classDef success fill:#e8f5e8

    class F,I,W,GG userAction
    class D,J,R,II,JJ systemProcess
    class AA,BB,CC,DD,N validation
    class C,P,FF error
    class L,S,KK success
```

## Detailed Component Interaction Flow

```mermaid
sequenceDiagram
    participant U as User
    participant VP as ValidationsPage
    participant VR as ValidationRow
    participant NVR as NewValidationRow
    participant CE as CodeEditor
    participant VA as ValidationAPI
    participant DB as Database

    Note over U,DB: 1. Loading Existing Validations
    U->>VP: Access /validations page
    VP->>DB: GET /api/validations/crud
    DB-->>VP: Return validation list
    VP->>VR: Render each validation

    Note over U,DB: 2. Creating New Validation
    U->>VP: Click "Add New Validation"
    VP->>NVR: Show creation form
    U->>NVR: Click "Use Template"
    NVR->>CE: Load standard template
    CE->>VA: Validate query (real-time)
    VA->>VA: Check core patterns
    VA->>VA: Validate SQL syntax
    VA->>DB: Check schema compatibility
    DB-->>VA: Return schema info
    VA-->>CE: Return validation results
    CE-->>U: Show errors/warnings

    Note over U,DB: 3. Saving New Validation
    U->>NVR: Fill form + fix errors
    U->>NVR: Click Save
    NVR->>VP: handleCreateNew()
    VP->>DB: POST /api/validations/crud
    DB->>DB: Generate unique ValidationID
    DB->>DB: Insert validation record
    DB-->>VP: Return success + ValidationID
    VP->>VP: Update validations list
    VP-->>U: Show updated table

    Note over U,DB: 4. Editing Existing Validation
    U->>VR: Click Edit button
    VR->>CE: Enable editing mode
    U->>CE: Modify query
    CE->>VA: Real-time validation
    VA-->>CE: Validation feedback
    U->>VR: Click Save
    VR->>VP: handleSaveChanges()
    VP->>DB: PATCH /api/validations/crud
    DB-->>VP: Update confirmation
    VP-->>U: Refresh display

    Note over U,DB: 5. Downloading Query
    U->>VR: Click Download button
    VR->>VR: Process query variables
    VR->>VR: Generate SQL file
    VR-->>U: Download processed query
```

## Validation Engine Detail Flow

```mermaid
flowchart TD
    A[Query Input] --> B[ValidationAPI /validate-query]
    B --> C[Basic SQL Syntax Check]
    C --> D{Syntax Valid?}
    D -->|No| E[Return Syntax Errors]
    D -->|Yes| F[Core Pattern Validation]

    F --> G[Check INSERT INTO cmverrors]
    G --> H[Check CoreMeasurementID/ValidationErrorID]
    H --> I[Check @validationProcedureID usage]
    I --> J[Check IsValidated IS NULL filter]
    J --> K[Check duplicate prevention pattern]
    K --> L[Check @p_PlotID/@p_CensusID parameters]

    L --> M[Schema Compatibility Check]
    M --> N[Extract table references]
    N --> O[Extract column references]
    O --> P[Query INFORMATION_SCHEMA]
    P --> Q[Validate table existence]
    Q --> R[Validate column existence]

    R --> S[Compile Results]
    S --> T[Return Validation Response]
    T --> U{Has Errors?}
    U -->|Yes| V[Block Save Action]
    U -->|No| W[Enable Save Action]

    V --> X[Display Error Messages]
    W --> Y[Display Success/Warnings]

    %% Styling
    classDef input fill:#e3f2fd
    classDef process fill:#f1f8e9
    classDef check fill:#fff3e0
    classDef error fill:#ffebee
    classDef success fill:#e8f5e8

    class A input
    class B,C,F,M,N,O,P,S process
    class G,H,I,J,K,L,Q,R check
    class E,V,X error
    class W,Y success
```

## Database Operations Flow

```mermaid
flowchart TD
    A[API Request] --> B{Operation Type}

    B -->|GET| C[Fetch Existing Validations]
    C --> D[SELECT * FROM sitespecificvalidations]
    D --> E[Return Validation List]

    B -->|POST| F[Create New Validation]
    F --> G[Begin Transaction]
    G --> H[Get Next ValidationID]
    H --> I[SELECT MAX(ValidationID) + 1]
    I --> J[Set ValidationID on Object]
    J --> K[INSERT INTO sitespecificvalidations]
    K --> L[Commit Transaction]
    L --> M[Return ValidationID + InsertID]

    B -->|PATCH| N[Update Existing Validation]
    N --> O[Begin Transaction]
    O --> P[UPDATE WHERE ValidationID = ?]
    P --> Q[Commit Transaction]
    Q --> R[Return Success]

    B -->|DELETE| S[Delete Validation]
    S --> T[Begin Transaction]
    T --> U[DELETE WHERE ValidationID = ?]
    U --> V[Commit Transaction]
    V --> W[Return Success]

    %% Error Handling
    G --> X{Transaction Fails?}
    X -->|Yes| Y[Rollback Transaction]
    Y --> Z[Return Error]
    X -->|No| L

    O --> AA{Update Fails?}
    AA -->|Yes| BB[Rollback Transaction]
    BB --> CC[Return Error]
    AA -->|No| Q

    %% Styling
    classDef operation fill:#e8eaf6
    classDef database fill:#e0f2f1
    classDef success fill:#e8f5e8
    classDef error fill:#ffebee

    class A,B operation
    class D,I,K,P,U database
    class E,M,R,W success
    class Y,Z,BB,CC error
```

## File Structure and Component Relationships

```mermaid
graph TB
    subgraph "Frontend Pages"
        VP[ValidationsPage<br/>/app/.../validations/page.tsx]
    end

    subgraph "React Components"
        VR[ValidationRow<br/>/components/validationrow.tsx]
        NVR[NewValidationRow<br/>/components/newvalidationrow.tsx]
        CE[CodeEditor<br/>/components/client/codeeditor.tsx]
    end

    subgraph "API Routes"
        CRUD[CRUD Operations<br/>/api/validations/crud/route.ts]
        VAL[Query Validation<br/>/api/validations/validate-query/route.ts]
        STRUCT[Schema Structure<br/>/api/structure/[schema]/route.ts]
    end

    subgraph "Database"
        SSV[(sitespecificvalidations)]
        CME[(cmverrors)]
        SCHEMA[(INFORMATION_SCHEMA)]
    end

    subgraph "External Dependencies"
        CM[CodeMirror]
        SQL[SQL Formatter]
        MUI[Material-UI]
    end

    %% Relationships
    VP --> VR
    VP --> NVR
    VR --> CE
    NVR --> CE

    VP --> CRUD
    CE --> VAL
    VAL --> STRUCT

    CRUD --> SSV
    VAL --> SCHEMA
    SSV -.-> CME

    CE --> CM
    CE --> SQL
    VP --> MUI
    VR --> MUI
    NVR --> MUI

    %% Styling
    classDef page fill:#e3f2fd
    classDef component fill:#f3e5f5
    classDef api fill:#fff3e0
    classDef database fill:#e0f2f1
    classDef external fill:#fafafa

    class VP page
    class VR,NVR,CE component
    class CRUD,VAL,STRUCT api
    class SSV,CME,SCHEMA database
    class CM,SQL,MUI external
```

## Key Features Summary

### 🔄 **Real-time Validation Flow**

1. User types SQL query
2. 1-second debounce delay
3. API validates syntax + patterns + schema
4. Results displayed immediately
5. Save button enabled/disabled based on validation

### 📋 **Template System**

1. "Use Template" button appears for empty queries
2. Loads corequeries.sql-compliant template
3. Includes all required patterns and parameters
4. Provides clear comments for customization

### 🔍 **Pattern Validation Engine**

- **Required Elements**: INSERT INTO cmverrors, @validationProcedureID, IsValidated IS NULL
- **Recommended Patterns**: DISTINCT, IsActive filters, duplicate prevention
- **Schema Validation**: Table/column existence, proper JOIN patterns

### 💾 **Database Integration**

- Automatic ValidationID generation
- Transaction-safe operations
- Proper error handling and rollback
- Integration with existing corequeries.sql structure

### 📁 **Download Functionality**

- Processes variable replacements (@p_PlotID, @p_CensusID)
- Generates clean SQL files
- Meaningful filename based on procedure name
