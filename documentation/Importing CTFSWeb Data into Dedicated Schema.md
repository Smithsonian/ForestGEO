# Importing CTFSWeb Data into Dedicated Schema
This is the first step of the overall process. Before you can fully migrate a sample ctfsweb flat file into the 
target `forestgeo` schema, you will need to first load the flat file into a schema that you can then reference for 
the migration process itself. Due to the size of these flat files and the significant differences between the 
`ctfsweb` data format and the `forestgeo` data format, directly attempting to parse the flat file into the target 
schema is not viable. 

## Before You Begin

Before getting started, please ensure you have the following starting components:
- A SQL flat file of an existing site
  - This should be a huge (think 100s of MBs) SQL file that contains a direct SQL dump of a full site's census history.

- An empty schema to migrate the old schema into
- An empty schema to migrate the data into
- Time!
  - A word to the wise, this takes a ridiculous amount of time, so make sure you have a couple of hours to spare. I'd
  - recommend making sure your machine is plugged in and has a steady internet connection.

---

For this guide, we're going to name the old schema `ctfsweb` and the new schema `forestgeo`.

### Why do you need to create a data source for the old data?
Migration from schema to schema is easier to work with than working from a flat file. Having the old data source directly
viewable will let you confirm whether the migration has worked by reviewing foreign key connections directly.
Additionally, the flat file will often contain other nonessential statements that can potentially disrupt the
execution of the flat file.

### Prerequisites:
1. Make sure you create the file `~/.my.cnf` in the `~` directory and add your connection credentials to it (example
   here):
```Bash
[client]
user=<username>
password=<password>
host=forestgeo-mysqldataserver.mysql.database.azure.com
```

> [!caution]-
> Make sure you replace the <> portions with your actual credentials! I've left the host endpoint as it is because
> that shouldn't change unless absolutely necessary, but make sure you check that as well.

### Loading Flat File Data

> [!tip]- 
> Due to versioning issues that tend to occur, directly running the flat file can sometimes cause issues.
> Furthermore, I've run into issues where a single bug or issue with a statement causes a cascading error effect,
> requiring fully resetting the schema and starting over.


I've developed a Bash script that will automatically handle the parsing and insertion process for the old (`ctfsweb`,
for this example)
schema.  
Please take advantage of this if possible—this will require:
1. The MySQL command-line interface
2. The above-mentioned configuration file, completed
3. Perl (the parsing language being used to break up the flat file)
4. Bash version >= 5.0 (make sure you know where it's located, you'll need to make sure you reference that
   particular version at the top of the script)

Once you have all of these elements, please create an empty Bash script in the same directory where your flat file
is, and copy-paste the following script into it:  
![[Joint File Parse & Execute]]

Once finished, please run the following command (Linux-based) to
make the bash script executable (feel free to change the name to whatever you prefer):
```Bash
chmod +x <your_file_name>.sh 
```  
You will need to run the script now. It requires three parameters:
```Text
1. Path to your flat file (in double quotes)
2. Name of the target schema (in double quotes).  
For this example, it would be `ctfsweb`.
3. Path to your configuration file (in double quotes).
I would recommend placing this file in your ~ directory, as that will 
simplify the path you need to enter.
```

### Waiting for the script to complete  
The script is designed to keep you informed of its progress as it executes. It has been divided into three primary 
stages:  
#### 1. Extraction:  

In order for the data insertion to work, the tables must be created in a specific order so that foreign key 
relationships are preserved.  

The following sample output provides a general idea of what the script will output as the extraction process completes:
![[Sample JFPE Extraction Output]]
#### 2. Execution  
Once the parsing is complete, the script has a sorted set of `DROP TABLE`, `CREATE TABLE`, and `INSERT INTO TABLE` 
statements that it will then execute. 
The second stage of this process runs the first two (DROP, CREATE) sets, and 
then waits for the user to press the Enter key to begin the insertion process. 
Again, here is sample output that shows what happens as the extraction process continues.   

![[Sample JFPE Execution Output]]
#### 3. Insertion   
The insertion process is fairly straightforward, but the most time-consuming part of this process. The script 
disables foreign key checking to make sure that data can be inserted in any order, and then begins the insertion 
process. 
##### Performance/Clarity Improvements
1. Batched insertions: While the flat file already breaks huge data insertions into slightly smaller, still large 
   chunks, these are also prone to failure, as each chunk is still inserting anywhere from thousands to 
   tens of thousands of rows at a time. After a bunch of these failures, the script's been updated to break apart 
   the chunks even further, into individual rows of data inserted per table. These individual rows are then grouped 
   per the variable `BATCH_SIZE` specified in the script. The script then inserts these batches instead of the 
   original chunks to better ensure that the insertion completes without issue.
2. Transaction/commits: To further make sure that the script doesn't completely break everything in case something 
   does work, the script will also insert data using transactions to make sure that in the event that a batch fails, 
   corrupted data is not inserted into the target table
3. Exit on error: Continuing the goal of making sure that time is not needlessly wasted in the event that the script 
   encounters an error, there is a hard-stop that will end the script as soon as an error occurs. 
