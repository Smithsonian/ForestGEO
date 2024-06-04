###### Bash:
```Bash
#!/usr/local/bin/bash  
  
# Check if the correct number of arguments are provided  
if [ "$#" -ne 3 ]; then  
    echo "Usage: $0 <source_sql_file> <destination_schema_name> <mysql_config_file>"    exit 1  
fi  
  
# Assign input parameters to variables  
source_file="$1"  
destination_schema="$2"  
mysql_config_file="$3"  
  
# Expand the MySQL config file path  
mysql_config_file="${mysql_config_file/#\~/$HOME}"  
  
# Check if source file exists  
if [ ! -f "$source_file" ]; then  
    echo "Error: Source SQL file '$source_file' does not exist."  
    exit 1  
fi  
  
# Check if MySQL config file exists  
if [ ! -f "$mysql_config_file" ]; then  
    echo "Error: MySQL config file '$mysql_config_file' does not exist."  
    exit 1  
fi  
  
# Temporary output files to hold the extracted SQL statements  
temp_output_file=$(mktemp)  
extracted_tables_file=$(mktemp)  
extracted_inserts_file=$(mktemp)  
tables_without_fk_file=$(mktemp)  
tables_with_fk_file=$(mktemp)  
drop_tables_file=$(mktemp)  
  
# Clean up the temporary files  
rm -f "$temp_output_file" "$extracted_tables_file" "$extracted_inserts_file" "$tables_without_fk_file" "$tables_with_fk_file" "$drop_tables_file"  
  
echo "Extracting SQL statements from $source_file..."  
  
# Extract SQL statements and table names  
perl -0777 -ne '  
use strict;  
use warnings;  
  
my %tables;  
my %foreign_keys;  
my %insert_statements;  
my %drop_statements;  
  
print "Starting extraction process\n";  
  
# Extract table definitions and capture foreign key references  
while (/DROP TABLE IF EXISTS `([^`]+)`;\s*\/\*[^*]*\*\/;\s*\/\*[^*]*\*\/;\s*CREATE TABLE `([^`]+)` \((.*?)\)\s*ENGINE=[^;]+;/sg) {  
    my $table_name = $1;    my $table_def = $&;    $tables{$table_name} = $table_def;    print "Captured table: $table_name\n";    while ($table_def =~ /FOREIGN KEY \(`[^`]+`\) REFERENCES `([^`]+)`/sg) {        my $referenced_table = $1;        push @{$foreign_keys{$table_name}}, $referenced_table;        print "Foreign key reference from $table_name to $referenced_table\n";    }}  
  
# Extract DROP TABLE statements  
while (/DROP TABLE IF EXISTS `([^`]+)`;/sg) {  
    my $table_name = $1;    my $drop_def = $&;    $drop_statements{$table_name} = $drop_def;    print "Captured DROP TABLE: $table_name\n";}  
  
# Separate tables into those with and without foreign key constraints  
my @tables_without_fk = grep { !exists $foreign_keys{$_} } keys %tables;  
my @tables_with_fk = grep { exists $foreign_keys{$_} } keys %tables;  
  
# Sort tables with foreign key constraints based on dependencies  
my %visited;  
my @sorted_tables_with_fk;  
  
sub visit {  
    my ($table) = @_;    return if $visited{$table};    $visited{$table} = 1;    if (exists $foreign_keys{$table}) {        visit($_) for @{$foreign_keys{$table}};    }    push @sorted_tables_with_fk, $table;    print "Visited table: $table\n";}  
  
visit($_) for @tables_with_fk;  
  
open my $table_fh, ">", "'$extracted_tables_file'" or die "Could not open file: $!";  
open my $tables_without_fk_fh, ">", "'$tables_without_fk_file'" or die "Could not open file: $!";  
open my $tables_with_fk_fh, ">", "'$tables_with_fk_file'" or die "Could not open file: $!";  
  
for my $table (@tables_without_fk) {  
    print "Writing table without FK to file: $table\n";    print $tables_without_fk_fh "$tables{$table};\n";}  
  
for my $table (@sorted_tables_with_fk) {  
    print "Writing table with FK to file: $table\n";    print $tables_with_fk_fh "$tables{$table};\n";}  
  
close $table_fh;  
close $tables_without_fk_fh;  
close $tables_with_fk_fh;  
  
# Extract INSERT INTO statements  
while (/INSERT INTO `([^`]+)` VALUES \((.*?)\);/sg) {  
    my $table = $1;    my $values = $2;    my @rows = $values =~ /\((.*?)\)/sg;    for my $row (@rows) {        push @{$insert_statements{$table}}, "($row)";    }    print "Captured INSERT INTO for table: $table\n";}  
  
open my $insert_fh, ">", "'$extracted_inserts_file'" or die "Could not open file: $!";  
foreach my $table (keys %insert_statements) {  
    foreach my $row (@{$insert_statements{$table}}) {        print $insert_fh "INSERT INTO `$table` VALUES $row;\n";    }}  
close $insert_fh;  
  
# Sort DROP TABLE statements based on dependencies  
my @sorted_drop_tables;  
%visited = ();  
  
sub visit_drop {  
    my ($table) = @_;    return if $visited{$table};    $visited{$table} = 1;    if (exists $foreign_keys{$table}) {        visit_drop($_) for @{$foreign_keys{$table}};    }    push @sorted_drop_tables, $table;    print "Visited drop table: $table\n";}  
  
visit_drop($_) for keys %drop_statements;  
  
open my $drop_fh, ">", "'$drop_tables_file'" or die "Could not open file: $!";  
for my $table (reverse @sorted_drop_tables) {  
    print "Writing DROP TABLE to file: $table\n";    print $drop_fh "$drop_statements{$table}\n";}  
close $drop_fh;  
  
print "Extraction process completed\n";  
' "$source_file"  
  
echo "Extraction complete."  
  
# Function to execute SQL statements  
execute_sql() {  
    local statement="$1"  
    if [ -n "$statement" ]; then  
        # Remove comments from the statement  
        statement=$(echo "$statement" | sed -e 's/\/\*[^*]*\*\/;//g' -e 's/\/\*[^*]*\*\/ //g')  
        # Trim leading and trailing whitespace  
        statement=$(echo "$statement" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')  
        if [ -n "$statement" ]; then  
            echo "Executing statement: $statement"  
            if ! mysql --defaults-file="$mysql_config_file" -D "$destination_schema" -e "$statement" 2>&1; then  
                echo "Error: There was an error executing the statement."  
                exit 1  
            else  
                echo "Success: The statement executed successfully."  
            fi  
            echo "========================="  
        fi  
    fi}  
  
# Set foreign_key_checks = 0 at the beginning  
mysql --defaults-file="$mysql_config_file" -D "$destination_schema" -e "SET foreign_key_checks = 0;" || { echo "Failed to set foreign_key_checks = 0"; exit 1; }  
  
# Read and execute each DROP TABLE statement  
current_statement=""  
while IFS= read -r line; do  
    current_statement="$current_statement$line "  
    if [[ "$line" == *\; ]]; then  
        execute_sql "$current_statement"  
        current_statement=""  
    fi  
done < "$drop_tables_file"  
  
# Read and execute each full statement from the tables without foreign keys file  
current_statement=""  
while IFS= read -r line; do  
    if [[ "$line" != INSERT* ]]; then  
        current_statement="$current_statement$line "  
        if [[ "$line" == *\; ]]; then  
            execute_sql "$current_statement"  
            current_statement=""  
        fi  
    fidone < "$tables_without_fk_file"  
  
# Read and execute each full statement from the tables with foreign keys file  
current_statement=""  
while IFS= read -r line; do  
    if [[ "$line" != INSERT* ]]; then  
        current_statement="$current_statement$line "  
        if [[ "$line" == *\; ]]; then  
            execute_sql "$current_statement"  
            current_statement=""  
        fi  
    fidone < "$tables_with_fk_file"  
  
# Wait for user input before proceeding with inserts  
read -p "Press Enter to start executing INSERT statements..."  
  
# Function to execute batched SQL statements and count rows  
execute_batched_sql() {  
    local batch="$1"  
    local table="$2"  
    local row_count="$3"  
    local batch_number="$4"  
    if [ -n "$batch" ]; then  
        echo "Executing batch $batch_number for table: $table"  
        echo "Number of rows in this batch: $row_count"  
        if ! mysql --defaults-file="$mysql_config_file" -D "$destination_schema" -e "START TRANSACTION; $batch COMMIT;" 2>&1; then  
            echo "Error: There was an error executing the batch."  
            exit 1  
        else  
            echo "Success: The batch executed successfully."  
        fi  
        echo "========================="  
    fi  
}  
  
# Function to verify row count  
verify_row_count() {  
    local table="$1"  
    local expected_count="$2"  
    local actual_count  
    actual_count=$(mysql --defaults-file="$mysql_config_file" -D "$destination_schema" -N -e "SELECT COUNT(*) FROM \`$table\`;")  
    if [ "$actual_count" -eq "$expected_count" ]; then  
        echo "Row count verification successful for table $table: $actual_count rows."    else  
        echo "Row count verification failed for table $table: expected $expected_count, but got $actual_count."  
        exit 1  
    fi  
}  
  
# Batch size for INSERT statements  
batch_size=500  # Number of rows per batch for testing  
  
# Read and process INSERT INTO statements  
declare -A insert_batches  
declare -A row_counts  
declare -A batch_numbers  
declare -A total_inserted_rows  
  
while IFS= read -r line; do  
    if [[ "$line" == INSERT* ]]; then  
        table=$(echo "$line" | awk -F '[`]' '{print $2}')  
        row=$(echo "$line" | awk -F 'VALUES ' '{print $2}')  
  
        if [[ -z "${insert_batches[$table]}" ]]; then  
            insert_batches[$table]="INSERT INTO \`$table\` VALUES $row"  
            row_counts[$table]=1  
            batch_numbers[$table]=1  
            total_inserted_rows[$table]=0  
            echo "Starting insertions for table: $table"  
        else  
            insert_batches[$table]="${insert_batches[$table]}, $row"  
            row_counts[$table]=$((row_counts[$table] + 1))  
        fi  
  
        # Check if current batch size exceeds limit  
        current_batch_size=$(echo "${insert_batches[$table]}" | grep -o '),' | wc -l)  
        if (( current_batch_size >= batch_size )); then  
            echo "Batch size exceeded for table $table, executing batch ${batch_numbers[$table]}..."  
            execute_batched_sql "${insert_batches[$table]};" "$table" "${row_counts[$table]}" "${batch_numbers[$table]}"  
            total_inserted_rows[$table]=$((total_inserted_rows[$table] + row_counts[$table]))  
            insert_batches[$table]=""  
            row_counts[$table]=0  
            batch_numbers[$table]=$((batch_numbers[$table] + 1))  
        fi  
    fidone < "$extracted_inserts_file"  
  
# Execute any remaining batches  
for table in "${!insert_batches[@]}"; do  
    if [[ -n "${insert_batches[$table]}" ]]; then  
        echo "Executing remaining batch ${batch_numbers[$table]} for table $table..."  
        execute_batched_sql "${insert_batches[$table]};" "$table" "${row_counts[$table]}" "${batch_numbers[$table]}"  
        total_inserted_rows[$table]=$((total_inserted_rows[$table] + row_counts[$table]))  
    fi  
done  
  
# Verify row counts for each table  
for table in "${!total_inserted_rows[@]}"; do  
    echo "Verifying row count for table $table..."  
    verify_row_count "$table" "${total_inserted_rows[$table]}"  
done  
  
# Set foreign_key_checks = 1 at the end  
mysql --defaults-file="$mysql_config_file" -D "$destination_schema" -e "SET foreign_key_checks = 1;" || { echo "Failed to set foreign_key_checks = 1"; exit 1; }  
  
# Clean up the temporary files  
rm "$temp_output_file"  
rm "$extracted_inserts_file"  
rm "$extracted_tables_file"  
rm "$tables_without_fk_file"  
rm "$tables_with_fk_file"  
rm "$drop_tables_file"  
  
echo "Schema definitions and INSERT INTO statements have been extracted and executed in the schema: $destination_schema"
```