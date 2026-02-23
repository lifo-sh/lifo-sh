import type { VFS } from './vfs/index.js';

export function installSamples(vfs: VFS): void {
  const base = '/home/user/examples';

  const dirs = [
    base,
    `${base}/scripts`,
    `${base}/data`,
    `${base}/node`,
  ];

  for (const dir of dirs) {
    try { vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
  }

  for (const [path, content] of Object.entries(SAMPLES)) {
    if (!vfs.exists(`${base}/${path}`)) {
      vfs.writeFile(`${base}/${path}`, content);
    }
  }
}

const SAMPLES: Record<string, string> = {

  // ─── README ───

  'README.txt': `BrowserOS Examples
==================

Explore these files to learn shell scripting and BrowserOS features.
Run any script with: source <script>  (or just paste commands)

Directory layout:
  scripts/   Shell scripts demonstrating compound commands & expansions
  data/      Sample data files for text processing commands
  node/      Node.js scripts (run with: node <script>)

Quick start:
  cat examples/README.txt        # You're reading this!
  ls examples/scripts/            # See available scripts
  source examples/scripts/01-if-elif-else.sh
  node examples/node/hello.js
`,

  // ─── Shell scripts ───

  'scripts/01-if-elif-else.sh': `#!/bin/sh
# Demonstrates: if / elif / else / fi

echo "=== If / Elif / Else ==="

# Simple if-then
if true; then echo "true is always true"; fi

# if-else
if false; then
  echo "this won't print"
else
  echo "false triggers the else branch"
fi

# if-elif-else with test builtin
score=85
if [ $score -ge 90 ]; then
  echo "Grade: A"
elif [ $score -ge 80 ]; then
  echo "Grade: B"
elif [ $score -ge 70 ]; then
  echo "Grade: C"
else
  echo "Grade: F"
fi

# Nested if
name="browseros"
if [ -n "$name" ]; then
  if [ "$name" = "browseros" ]; then
    echo "Welcome to BrowserOS!"
  fi
fi

echo "Done."
`,

  'scripts/02-for-loops.sh': `#!/bin/sh
# Demonstrates: for loops with word lists, variables, and globs

echo "=== For Loops ==="

# Basic word list
echo "--- Fruits ---"
for fruit in apple banana cherry; do
  echo "  I like $fruit"
done

# Loop over numbers using arithmetic
echo "--- Squares ---"
for n in 1 2 3 4 5; do
  sq=$(($n * $n))
  echo "  $n^2 = $sq"
done

# Loop with variable expansion
colors="red green blue"
echo "--- Colors ---"
for c in $colors; do
  echo "  Color: $c"
done

# Loop over files (try: touch /tmp/a.txt /tmp/b.txt first)
echo "--- Files in /etc ---"
for f in /etc/motd /etc/hostname /etc/profile; do
  if [ -e $f ]; then
    echo "  Found: $f"
  fi
done

echo "Done."
`,

  'scripts/03-while-until.sh': `#!/bin/sh
# Demonstrates: while and until loops with break and continue

echo "=== While Loop ==="

# Count to 5
i=1
while [ $i -le 5 ]; do
  echo "  count: $i"
  i=$(($i + 1))
done

echo "=== Until Loop ==="

# Until is the opposite of while
j=1
until [ $j -gt 5 ]; do
  echo "  count: $j"
  j=$(($j + 1))
done

echo "=== Break Example ==="

# Break out of a loop
k=1
while true; do
  if [ $k -gt 3 ]; then
    break
  fi
  echo "  k=$k"
  k=$(($k + 1))
done

echo "=== Continue Example ==="

# Skip even numbers
n=0
while [ $n -lt 6 ]; do
  n=$(($n + 1))
  if [ $(($n % 2)) -eq 0 ]; then
    continue
  fi
  echo "  odd: $n"
done

echo "Done."
`,

  'scripts/04-case.sh': `#!/bin/sh
# Demonstrates: case statements with patterns

echo "=== Case Statement ==="

# Match an OS name
os="browseros"
case $os in
  linux)
    echo "Running Linux"
    ;;
  macos|darwin)
    echo "Running macOS"
    ;;
  browseros)
    echo "Running BrowserOS!"
    ;;
  *)
    echo "Unknown OS: $os"
    ;;
esac

# Glob patterns in case
echo "--- File type check ---"
for file in script.sh readme.txt photo.png data.json; do
  case $file in
    *.sh)
      echo "  $file -> shell script"
      ;;
    *.txt|*.md)
      echo "  $file -> text file"
      ;;
    *.png|*.jpg)
      echo "  $file -> image"
      ;;
    *)
      echo "  $file -> other"
      ;;
  esac
done

echo "Done."
`,

  'scripts/05-functions.sh': `#!/bin/sh
# Demonstrates: function definitions, arguments, return values

echo "=== Functions ==="

# Simple function
greet() {
  echo "Hello, $1!"
}

greet World
greet BrowserOS

# Function with multiple args
add() {
  echo $(($1 + $2))
}

echo "--- Arithmetic ---"
echo "3 + 4 = $(add 3 4)"
echo "10 + 20 = $(add 10 20)"

# Function using $# and $@
show_args() {
  echo "  Received $# arguments: $@"
}

echo "--- Arguments ---"
show_args a b c
show_args hello world

# Function with return
is_even() {
  if [ $(($1 % 2)) -eq 0 ]; then
    return 0
  else
    return 1
  fi
}

echo "--- Even/Odd ---"
for n in 1 2 3 4 5; do
  if is_even $n; then
    echo "  $n is even"
  else
    echo "  $n is odd"
  fi
done

# Recursive-style (via loop)
factorial() {
  result=1
  i=1
  while [ $i -le $1 ]; do
    result=$(($result * $i))
    i=$(($i + 1))
  done
  echo $result
}

echo "--- Factorials ---"
for n in 1 2 3 4 5 6; do
  echo "  $n! = $(factorial $n)"
done

echo "Done."
`,

  'scripts/06-arithmetic.sh': `#!/bin/sh
# Demonstrates: $(( )) arithmetic expansion

echo "=== Arithmetic Expansion ==="

# Basic operations
echo "2 + 3 = $((2 + 3))"
echo "10 - 4 = $((10 - 4))"
echo "6 * 7 = $((6 * 7))"
echo "20 / 3 = $((20 / 3))"
echo "20 % 3 = $((20 % 3))"
echo "2 ** 10 = $((2 ** 10))"

# Variables in arithmetic
x=15
y=4
echo ""
echo "x=$x, y=$y"
echo "x + y = $(($x + $y))"
echo "x * y = $(($x * $y))"
echo "x / y = $(($x / $y))"

# Comparison (returns 1 for true, 0 for false)
echo ""
echo "5 > 3  = $((5 > 3))"
echo "5 < 3  = $((5 < 3))"
echo "5 == 5 = $((5 == 5))"

# Bitwise
echo ""
echo "--- Bitwise ---"
echo "5 & 3  = $((5 & 3))"
echo "5 | 3  = $((5 | 3))"
echo "5 ^ 3  = $((5 ^ 3))"
echo "1 << 4 = $((1 << 4))"

# Ternary
echo ""
val=42
echo "val=$val is $((val > 0 ? 1 : 0)) (positive check)"

# Assignment in arithmetic
echo ""
echo "Before: a is unset"
echo "Result: $((a = 100))"
echo "After:  a=$a"

echo "Done."
`,

  'scripts/07-parameter-expansion.sh': '#!/bin/sh\n\
# Demonstrates: advanced ${} parameter expansion\n\
\n\
echo "=== Parameter Expansion ==="\n\
\n\
# String length\n\
greeting="Hello, World!"\n\
echo "greeting = \'$greeting\'"\n\
echo "Length:   \\${#greeting} = ${#greeting}"\n\
\n\
# Prefix removal\n\
path="/home/user/documents/report.txt"\n\
echo ""\n\
echo "path = \'$path\'"\n\
echo "Remove shortest prefix */: \\${path#*/}  = ${path#*/}"\n\
echo "Remove longest prefix */:  \\${path##*/} = ${path##*/}"\n\
\n\
# Suffix removal\n\
file="archive.tar.gz"\n\
echo ""\n\
echo "file = \'$file\'"\n\
echo "Remove shortest suffix .*: \\${file%.*}  = ${file%.*}"\n\
echo "Remove longest suffix .*:  \\${file%%.*} = ${file%%.*}"\n\
\n\
# Substitution\n\
msg="hello hello world"\n\
echo ""\n\
echo "msg = \'$msg\'"\n\
echo "Replace first: \\${msg/hello/goodbye} = ${msg/hello/goodbye}"\n\
echo "Replace all:   \\${msg//hello/goodbye} = ${msg//hello/goodbye}"\n\
\n\
# Substring\n\
str="BrowserOS"\n\
echo ""\n\
echo "str = \'$str\'"\n\
echo "From index 7:       \\${str:7}   = ${str:7}"\n\
echo "From index 0 len 7: \\${str:0:7} = ${str:0:7}"\n\
\n\
# Defaults\n\
echo ""\n\
echo "Unset var with default: \\${UNSET:-fallback} = ${UNSET:-fallback}"\n\
color="blue"\n\
echo "Set var with default:   \\${color:-fallback} = ${color:-fallback}"\n\
\n\
# Assign default\n\
echo ""\n\
echo "Assign default: \\${newvar:=assigned} = ${newvar:=assigned}"\n\
echo "newvar is now: $newvar"\n\
\n\
echo "Done."\n',

  'scripts/08-test-builtin.sh': `#!/bin/sh
# Demonstrates: test / [ ] conditional expressions

echo "=== Test Builtin ==="

# String tests
echo "--- String Tests ---"
name="browseros"
if [ -n "$name" ]; then echo "  name is non-empty: $name"; fi
if [ -z "" ]; then echo "  empty string is zero-length"; fi
if [ "$name" = "browseros" ]; then echo "  name equals browseros"; fi
if [ "$name" != "linux" ]; then echo "  name is not linux"; fi

# Integer comparisons
echo "--- Integer Tests ---"
a=10
b=20
if [ $a -lt $b ]; then echo "  $a < $b"; fi
if [ $a -le 10 ]; then echo "  $a <= 10"; fi
if [ $b -gt $a ]; then echo "  $b > $a"; fi
if [ $b -ge 20 ]; then echo "  $b >= 20"; fi
if [ $a -ne $b ]; then echo "  $a != $b"; fi
if [ $a -eq 10 ]; then echo "  $a == 10"; fi

# File tests
echo "--- File Tests ---"
if [ -e /etc/motd ]; then echo "  /etc/motd exists"; fi
if [ -f /etc/hostname ]; then echo "  /etc/hostname is a file"; fi
if [ -d /home ]; then echo "  /home is a directory"; fi
if [ ! -e /nonexistent ]; then echo "  /nonexistent does not exist"; fi

# Logical operators
echo "--- Logical Tests ---"
if [ -d /home -a -d /etc ]; then echo "  /home AND /etc are directories"; fi
if [ -e /nope -o -e /etc/motd ]; then echo "  at least one path exists"; fi

echo "Done."
`,

  'scripts/09-pipes-and-redirection.sh': `#!/bin/sh
# Demonstrates: pipelines, redirections, and text processing

echo "=== Pipes & Redirection ==="

# Create sample data
echo "banana" > /tmp/fruits.txt
echo "apple" >> /tmp/fruits.txt
echo "cherry" >> /tmp/fruits.txt
echo "banana" >> /tmp/fruits.txt
echo "date" >> /tmp/fruits.txt
echo "apple" >> /tmp/fruits.txt

echo "--- /tmp/fruits.txt ---"
cat /tmp/fruits.txt

echo "--- Sorted ---"
cat /tmp/fruits.txt | sort

echo "--- Sorted & Unique ---"
cat /tmp/fruits.txt | sort | uniq

echo "--- Count per fruit ---"
cat /tmp/fruits.txt | sort | uniq -c

echo "--- Only fruits starting with 'a' ---"
grep "^a" /tmp/fruits.txt

echo "--- Word count ---"
wc /tmp/fruits.txt

echo "--- Reverse each line ---"
cat /tmp/fruits.txt | rev

echo "--- Uppercase ---"
cat /tmp/fruits.txt | tr a-z A-Z

echo "--- Pipeline to file ---"
cat /tmp/fruits.txt | sort | uniq > /tmp/unique-fruits.txt
echo "Wrote /tmp/unique-fruits.txt:"
cat /tmp/unique-fruits.txt

echo "Done."
`,

  'scripts/10-comprehensive.sh': `#!/bin/sh
# A comprehensive demo combining multiple features

echo "=== BrowserOS Shell Demo ==="

# Functions
repeat() {
  i=0
  while [ $i -lt $2 ]; do
    echo "$1"
    i=$(($i + 1))
  done
}

max() {
  if [ $1 -gt $2 ]; then
    echo $1
  else
    echo $2
  fi
}

# Generate multiplication table
echo "--- Multiplication Table (1-5) ---"
for i in 1 2 3 4 5; do
  line=""
  for j in 1 2 3 4 5; do
    prod=$(($i * $j))
    line="$line $prod"
  done
  echo " $line"
done

# FizzBuzz
echo ""
echo "--- FizzBuzz (1-20) ---"
n=1
while [ $n -le 20 ]; do
  if [ $(($n % 15)) -eq 0 ]; then
    echo "  $n: FizzBuzz"
  elif [ $(($n % 3)) -eq 0 ]; then
    echo "  $n: Fizz"
  elif [ $(($n % 5)) -eq 0 ]; then
    echo "  $n: Buzz"
  else
    echo "  $n"
  fi
  n=$(($n + 1))
done

# File operations
echo ""
echo "--- Creating temp files ---"
for name in alpha beta gamma; do
  echo "Content of $name" > /tmp/$name.txt
  echo "  Created /tmp/$name.txt"
done

echo ""
echo "--- Reading them back ---"
for f in /tmp/alpha.txt /tmp/beta.txt /tmp/gamma.txt; do
  if [ -f $f ]; then
    echo "  $f: $(cat $f)"
  fi
done

# Cleanup
rm /tmp/alpha.txt /tmp/beta.txt /tmp/gamma.txt

echo ""
echo "Max of 42 and 17: $(max 42 17)"
echo ""
echo "All done!"
`,

  // ─── Data files for text processing ───

  'data/colors.csv': `name,hex,category
red,#FF0000,warm
orange,#FFA500,warm
yellow,#FFFF00,warm
green,#00FF00,cool
blue,#0000FF,cool
indigo,#4B0082,cool
violet,#EE82EE,cool
white,#FFFFFF,neutral
black,#000000,neutral
gray,#808080,neutral
`,

  'data/words.txt': `the quick brown fox jumps over the lazy dog
pack my box with five dozen liquor jugs
how vexingly quick daft zebras jump
the five boxing wizards jump quickly
a mad boxer shot a quick gloved jab to the jaw
`,

  'data/numbers.txt': `42
17
8
99
3
55
23
71
42
8
17
100
1
`,

  'data/servers.log': `2024-01-15 08:00:01 INFO  web-01 Request /api/users 200 45ms
2024-01-15 08:00:03 WARN  web-02 Slow query on /api/search 200 2100ms
2024-01-15 08:00:05 INFO  web-01 Request /api/health 200 2ms
2024-01-15 08:00:07 ERROR web-03 Connection refused to db-master
2024-01-15 08:00:09 INFO  web-01 Request /api/users/42 200 38ms
2024-01-15 08:00:11 INFO  web-02 Request /api/products 200 67ms
2024-01-15 08:00:13 ERROR web-01 Timeout on /api/reports 504 30000ms
2024-01-15 08:00:15 INFO  web-03 Request /api/health 200 3ms
2024-01-15 08:00:17 WARN  web-02 High memory usage: 89%
2024-01-15 08:00:19 INFO  web-01 Request /api/login 200 120ms
`,

  'data/users.json': `{
  "users": [
    { "id": 1, "name": "Alice",   "role": "admin",  "active": true },
    { "id": 2, "name": "Bob",     "role": "user",   "active": true },
    { "id": 3, "name": "Charlie", "role": "user",   "active": false },
    { "id": 4, "name": "Diana",   "role": "editor", "active": true },
    { "id": 5, "name": "Eve",     "role": "admin",  "active": true }
  ]
}
`,

  // ─── Node.js scripts ───

  'node/hello.js': `// Run with: node examples/node/hello.js
console.log("Hello from Node.js on BrowserOS!");
console.log("Platform:", process.platform);
console.log("Node version:", process.version);
console.log("Current directory:", process.cwd());
`,

  'node/fibonacci.js': `// Run with: node examples/node/fibonacci.js
// Fibonacci sequence generator

function fibonacci(n) {
  const seq = [0, 1];
  for (let i = 2; i < n; i++) {
    seq.push(seq[i - 1] + seq[i - 2]);
  }
  return seq.slice(0, n);
}

const count = parseInt(process.argv[2]) || 10;
const result = fibonacci(count);

console.log(\`First \${count} Fibonacci numbers:\`);
console.log(result.join(", "));
console.log(\`\\nSum: \${result.reduce((a, b) => a + b, 0)}\`);
`,

  'node/fs-demo.js': `// Run with: node examples/node/fs-demo.js
// Demonstrates Node.js fs operations on the BrowserOS VFS

const fs = require("fs");
const path = require("path");

const dir = "/tmp/node-demo";

// Create directory
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}
console.log("Created directory:", dir);

// Write files
for (let i = 1; i <= 3; i++) {
  const file = path.join(dir, \`file\${i}.txt\`);
  fs.writeFileSync(file, \`This is file \${i}\\nCreated by Node.js\\n\`);
  console.log("Wrote:", file);
}

// List directory
console.log("\\nDirectory listing:");
const entries = fs.readdirSync(dir);
for (const entry of entries) {
  const full = path.join(dir, entry);
  const stat = fs.statSync(full);
  console.log(\`  \${entry} (\${stat.size} bytes)\`);
}

// Read a file back
console.log("\\nContents of file1.txt:");
console.log(fs.readFileSync(path.join(dir, "file1.txt"), "utf-8"));

// Append to a file
fs.appendFileSync(path.join(dir, "file1.txt"), "Appended line\\n");
console.log("After append:");
console.log(fs.readFileSync(path.join(dir, "file1.txt"), "utf-8"));

console.log("Done!");
`,

  'node/json-processor.js': `// Run with: node examples/node/json-processor.js
// Reads and processes the sample users.json

const fs = require("fs");

const data = JSON.parse(
  fs.readFileSync("/home/user/examples/data/users.json", "utf-8")
);

console.log("=== User Report ===\\n");

console.log(\`Total users: \${data.users.length}\`);
console.log(\`Active: \${data.users.filter(u => u.active).length}\`);
console.log(\`Inactive: \${data.users.filter(u => !u.active).length}\`);

console.log("\\nBy role:");
const roles = {};
for (const user of data.users) {
  roles[user.role] = (roles[user.role] || 0) + 1;
}
for (const [role, count] of Object.entries(roles)) {
  console.log(\`  \${role}: \${count}\`);
}

console.log("\\nAdmin users:");
for (const user of data.users.filter(u => u.role === "admin")) {
  console.log(\`  \${user.name} (active: \${user.active})\`);
}
`,

  // ─── Text processing cheatsheet ───

  'scripts/11-text-processing.sh': '#!/bin/sh\n\
# Demonstrates: grep, sort, uniq, wc, cut, tr, head, tail, sed, awk\n\
\n\
echo "=== Text Processing Commands ==="\n\
echo "(Using sample data from examples/data/)"\n\
\n\
data="/home/user/examples/data"\n\
\n\
echo "--- grep: Find errors in logs ---"\n\
grep ERROR $data/servers.log\n\
\n\
echo ""\n\
echo "--- grep: Count warnings ---"\n\
grep -c WARN $data/servers.log\n\
\n\
echo ""\n\
echo "--- sort & uniq: Sort numbers ---"\n\
sort -n $data/numbers.txt | head -5\n\
\n\
echo ""\n\
echo "--- uniq: Find duplicates ---"\n\
sort $data/numbers.txt | uniq -d\n\
\n\
echo ""\n\
echo "--- wc: Count lines/words/chars ---"\n\
wc $data/words.txt\n\
\n\
echo ""\n\
echo "--- cut: Extract CSV columns ---"\n\
echo "Color names:"\n\
cut -d, -f1 $data/colors.csv | tail -n +2\n\
\n\
echo ""\n\
echo "--- tr: Lowercase to uppercase ---"\n\
echo "hello world" | tr a-z A-Z\n\
\n\
echo ""\n\
echo "--- head & tail ---"\n\
echo "First 3 log entries:"\n\
head -3 $data/servers.log\n\
echo "Last 2 log entries:"\n\
tail -2 $data/servers.log\n\
\n\
echo ""\n\
echo "--- awk: Extract fields ---"\n\
echo "Log levels:"\n\
awk \'{ print $3 }\' $data/servers.log | sort | uniq -c\n\
\n\
echo ""\n\
echo "--- sed: Substitution ---"\n\
echo "Replace ERROR with CRITICAL:"\n\
sed \'s/ERROR/CRITICAL/g\' $data/servers.log | grep CRITICAL\n\
\n\
echo "Done."\n',

  'scripts/12-system-commands.sh': `#!/bin/sh
# Demonstrates: system information and process commands

echo "=== System Commands ==="

echo "--- uname ---"
uname -a

echo ""
echo "--- hostname ---"
hostname

echo ""
echo "--- whoami ---"
whoami

echo ""
echo "--- date ---"
date

echo ""
echo "--- uptime ---"
uptime

echo ""
echo "--- env (first 5 vars) ---"
env | head -5

echo ""
echo "--- cal ---"
cal

echo ""
echo "--- free ---"
free

echo ""
echo "--- df ---"
df

echo ""
echo "--- which echo ---"
which echo

echo ""
echo "--- Filesystem tree (home) ---"
tree /home/user -L 2

echo "Done."
`,

};
