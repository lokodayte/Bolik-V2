with open('/home/lokodayte/Desktop/bolik/index.html', 'r') as f:
    content = f.read()

# Find the admin tabs context
idx = content.find("Accounts</button>` : ''}")
if idx == -1:
    print("Pattern not found, searching...")
    idx2 = content.find("Accounts</button>")
    if idx2 != -1:
        print("Found at:", idx2)
        print("Context:", repr(content[idx2:idx2+80]))
else:
    old = "Accounts</button>` : ''}"
    new = "Accounts</button>` : ''}<button class=\"${adminTab === 'team' ? 'active' : ''}\" onclick=\"adminNav('team')\">Team Members</button>"
    content = content.replace(old, new, 1)
    print("Team tab injected")
    with open('/home/lokodayte/Desktop/bolik/index.html', 'w') as f:
        f.write(content)
    print("File saved")
