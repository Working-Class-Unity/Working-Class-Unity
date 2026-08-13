export type BylawsInlinePart =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'strong'; text: string }>
  | Readonly<{ kind: 'link'; text: string; href: string }>

export type BylawsBlock =
  | Readonly<{ kind: 'paragraph'; parts: readonly BylawsInlinePart[] }>
  | Readonly<{
      kind: 'ordered-list' | 'unordered-list'
      items: readonly (readonly BylawsInlinePart[])[]
    }>

export type BylawsSection = Readonly<{
  id: string
  number: string
  title: string
  blocks: readonly BylawsBlock[]
}>

export type BylawsArticle = Readonly<{
  id: string
  number: string
  title: string
  blocks: readonly BylawsBlock[]
  sections: readonly BylawsSection[]
}>

export const bylawsSource = {
  title: 'Working Class Unity Bylaws',
  url: 'https://chat.workingclassunity.com/t/working-class-unity-bylaws/303',
  updatedAt: '2026-02-12T12:01:43.145Z'
} as const

export const bylawsArticles = [
  {
    id: 'article-i',
    number: 'I',
    title: 'NAME',
    blocks: [
      {
        kind: 'paragraph',
        parts: [
          {
            kind: 'text',
            text: 'The name of this organization shall be Working Class Unity (WCU), a not-for-profit corporation registered in the state of California.'
          }
        ]
      }
    ],
    sections: []
  },
  {
    id: 'article-ii',
    number: 'II',
    title: 'MISSION',
    blocks: [
      {
        kind: 'paragraph',
        parts: [
          {
            kind: 'text',
            text: 'Working Class Unity is a member-driven, democratic organization committed to the open advancement of socialism. We prioritize the recruitment, education, and support of people committed to advocating for working-class power. Our mission is to forge alliances between labor, community, and social movements. We acknowledge that our objectives will not be achieved quickly or easily. We are dedicated to the journey ahead, confident that through solidarity and collective action, we can build a robust movement for socialism and create a better world for all.'
          }
        ]
      }
    ],
    sections: []
  },
  {
    id: 'article-iii',
    number: 'III',
    title: 'MEMBERSHIP',
    blocks: [],
    sections: [
      {
        id: 'article-iii-section-1',
        number: '1',
        title: 'ELIGIBILITY',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Members of Working Class Unity shall be those individuals who are in good standing.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iii-section-2',
        number: '2',
        title: 'GOOD STANDING',
        blocks: [
          {
            kind: 'ordered-list',
            items: [
              [
                {
                  kind: 'text',
                  text: 'Dues: Members shall be considered in good standing if their dues are paid in full, allowing for a 30-day late grace period.'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Attendance: Members begin in good standing. Members in good standing must attend at least one regular meeting per year.'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Conduct: Members in good standing are required to adhere to the values and mission of WCU, refraining from any behavior that violates WCU’s Code of Conduct.'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Residency: Members in good standing must reside, work, attend school, or a place of worship in San Joaquin County, California.'
                }
              ]
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Members in good standing shall possess full voting rights, may hold any office or serve any committee, and may propose business to the membership at any time.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Members of the public who support the mission and purpose of WCU are welcome to participate in the organization’s activities, but shall not have voting rights, nor be eligible to hold office or chair a committee.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iii-section-3',
        number: '3',
        title: 'DUES',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Membership shall determine any local dues or pledges. Payment of local dues or pledges shall not grant members additional rights or privileges, nor shall separate classes of membership be established.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iii-section-4',
        number: '4',
        title: 'CENSURE AND REMOVAL OF MEMBERS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'In the event that a member is found to be in significant violation of WCU’s Code of Conduct, any Member or the Steering Committee may put forth a recommendation for censure or expulsion, citing specific offenses as outlined in the Code of Conduct (see '
              },
              {
                kind: 'link',
                text: 'Code of Conduct Article VI: Prohibited Behavior',
                href: 'https://chat.workingclassunity.com/docs?topic=186#article-vi-prohibited-behavior-22'
              },
              {
                kind: 'text',
                text: '). Such a recommendation must be ratified by a two-thirds majority vote of eligible members at a General Meeting. Additionally, any Member or the Steering Committee member may initiate a vote for censure or expulsion at the subsequent General Meeting if a member is found to be in substantial disagreement with the organization’s principles or policies, engages in entryist behavior, or acts under the discipline of another organization.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iii-section-5',
        number: '5',
        title: 'DISCLOSURES',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'All members are required to disclose any employment as a law enforcement officer, supervisorial authority as defined by the National Labor Relations Act in their workplace, or as human resources personnel, due to the potential for direct involvement in disciplining the working class. Additionally, members must disclose if they are landlords, specifically if they derive a majority of their income from residential rent for properties they own but do not personally occupy. Members must also disclose if they hold a position on the Board or any leadership role in a non-profit organization that receives over $50,000 in grants and contributions annually. The Secretary is tasked with collecting these disclosures and maintaining a record that is readily available for review by any member in good standing, without the need for a request to the Steering Committee.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iii-section-6',
        number: '6',
        title: 'NON-DISCRIMINATION POLICY',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'WCU shall not discriminate against any member or potential member on the basis of race, religion, gender, national origin, age, sexual orientation, disability, or any other characteristic protected under applicable law in any of its activities, including membership, governance, and operations.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-iv',
    number: 'IV',
    title: 'GOVERNANCE',
    blocks: [],
    sections: [
      {
        id: 'article-iv-section-1',
        number: '1',
        title: 'ORGANIZATIONAL STRUCTURE',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Working Class Unity shall be governed and led by the democratic participation of its membership. General Meetings serve as the organization’s primary governing body, while other meetings facilitate the execution of the organization’s work.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iv-section-2',
        number: '2',
        title: 'GENERAL MEETINGS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'General Meetings shall be convened at least quarterly and may be postponed or deferred by the membership for compelling reasons. An annual meeting or convention may be called upon a motion of the membership.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iv-section-3',
        number: '3',
        title: 'QUORUM',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.1 Determination of Quorum:'
              },
              {
                kind: 'text',
                text: ' The quorum for all General Meetings shall be determined by calculating the average number of members present at the start of each meeting and at the time of each vote taken during that meeting. This average attendance for a single meeting shall then be recorded. The quorum for future General Meetings shall be established by averaging these single-meeting averages from the six most recent General Meetings.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.2 Calculating the Average Attendance:'
              },
              {
                kind: 'text',
                text: ' For the purposes of determining quorum, “average attendance” shall be defining as the sum total of members in Good Standing present at each of the six most recent General Meetings, divided by the number of those meetings. Only meetings where official minutes were recorded and attendance was taken shall be included in this calculation.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.3 Rounding:'
              },
              {
                kind: 'text',
                text: ' If the calculation of fifty percent (50%) of the average attendance results in a fractional number, the quorum shall be rounded up to the nearest whole number.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.4 Record Keeping and Notification:'
              },
              {
                kind: 'text',
                text: ' The Secretary shall be responsible for maintaining accurate records of attendance at all General Meetings and shall calculate and inform the membership of the current quorum requirements in the minutes of the latest General Meeting as well as the start of the upcoming General Meeting.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.5 Maintenance of Quorum:'
              },
              {
                kind: 'text',
                text: ' To ensure quorum is maintained, the quorum will be reassessed immediately prior to any vote taking place, but only if there is change in the number of members present compared to the start of the meeting or compared to the time of the previous vote when quorum was confirmed. If at any point the number of members in good standing present drops below the required quorum due to changes in attendance, no vote shall be conducted until the quorum is re-established.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iv-section-4',
        number: '4',
        title: 'NOTIFICATION OF MEETINGS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Members shall receive at least one-week notice of upcoming General Meetings. The Steering Committee shall set the agenda for public meetings and communicate it along with notifications of any new business to the membership. Members may request to add agenda items by contacting a member of the Steering Committee or introducing an amendment to the agenda during the meeting itself. Notifications of meetings, new business, meeting minutes, and elections shall be disseminated through any communication channels authorized by the membership.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iv-section-5',
        number: '5',
        title: 'ORDER OF BUSINESS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The default order of business for General Meetings shall be as follows:'
              }
            ]
          },
          {
            kind: 'ordered-list',
            items: [
              [
                {
                  kind: 'text',
                  text: 'Call to Order'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Roll Call'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Introductions'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Minutes of the Previous Meeting'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Reports of Members Sick or in Distress'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Reports of Officers & Committees'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Unfinished Business'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'New Business + Additional Agenda Items'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Financial Report'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Announcements'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'Adjournment'
                }
              ]
            ]
          }
        ]
      },
      {
        id: 'article-iv-section-6',
        number: '6',
        title: 'PARLIAMENTARY AUTHORITY',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Robert’s Rules of Order, Newly Revised, shall govern Working Class Unity in all applicable cases and in instances where they are not inconsistent with these bylaws and any special rules of order that WCU may adopt.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'A motion cannot be both moved and seconded by Steering Committee members alone.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-iv-section-7',
        number: '7',
        title: 'CONFLICTS OF INTEREST',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'All Members shall adhere to the Conflict of Interest Policy.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Annually, Steering Committee members must complete, sign, and present a Conflict of Interest Disclosure Form to the Membership for approval during a General Meeting.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-v',
    number: 'V',
    title: 'VOTING AND ELECTIONS',
    blocks: [],
    sections: [
      {
        id: 'article-v-section-1',
        number: '1',
        title: 'POSITIONS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Elections will be held for Officers and any other office created by the Membership. Any and all members in good standing are eligible to vote, nominate candidates, or hold office.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-v-section-2',
        number: '2',
        title: 'NOMINATIONS COMMITTEE',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'A Nominations Committee, consisting of two members, shall be established by a vote of the membership. This vote must take place at least two General Meetings prior to every election. This committee is tasked with overseeing the nomination process for elected positions within the organization.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-v-section-3',
        number: '3',
        title: 'VOTING',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Steering Committee shall take all necessary measures to ensure maximum participation of the membership.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.1 Majority Voting System:'
              },
              {
                kind: 'text',
                text: ' Elections shall be conducted using a majority voting system. In this system, the candidate who receives a majority of votes is declared the winner.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.2 Determination of Majority:'
              },
              {
                kind: 'text',
                text: ' A simple majority is defined as more than half of the valid votes cast. Abstentions shall not be counted in determining the majority. If no candidate receives a simple majority, a run-off vote between the top tied candidates will be conducted during the same General Meeting.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.3 Transparency of votes:'
              },
              {
                kind: 'text',
                text: ' All votes cast in elections shall be recorded by name and made available for inspection by all members in good standing.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.4: Access to Voting Records:'
              },
              {
                kind: 'text',
                text: ' The voting records, including the names of their respective votes, shall be maintained by the Secretary and shall be accessible to members in good standing upon request.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-vi',
    number: 'VI',
    title: 'STEERING COMMITTEE',
    blocks: [],
    sections: [
      {
        id: 'article-vi-section-1',
        number: '1',
        title: 'ROLE AND COMPOSITION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Steering Committee shall be elected by the Membership to execute the decisions of the Membership and perform administrative duties required for the operation of WCU. The Steering Committee shall consist of Treasurer, Secretary, Membership Coordinator, Education Coordinator and Campaign Coordinator. All members of the Steering Committee are responsible for coordinating with ongoing campaigns, attending Steering Committee meetings, and generally implementing the will of the Membership as expressed at the General Meetings. Elections for the Steering Committee shall be held in December, with terms beginning and ending corresponding to the fiscal year.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-2',
        number: '2',
        title: 'DELEGATION AND MEETINGS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Except where genuine issues of confidentiality, security, access, or other insurmountable practical barriers exist, all Steering Committee members shall work to delegate responsibilities to rank-and-file membership as part of the Membership Pipeline system. Steering may delegate new responsibilities to its members as the need arises. The Steering Committee shall hold regular meetings open to the membership.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-3',
        number: '3',
        title: 'QUORUM AND COMMUNICATION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'A quorum for conducting Steering Committee business shall consist of two-thirds of its members. The Steering Committee shall meet at least once a month, and meetings shall be announced to and open to the attendance of all members in good standing.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-4',
        number: '4',
        title: 'COMMUNICATION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.1 Meeting Documentation:'
              },
              {
                kind: 'text',
                text: ' All Steering Committee Meetings shall be documented, with recordings and meeting minutes made readily accessible to members in good standing for review and commentary.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.2 Communication Channels:'
              },
              {
                kind: 'text',
                text: ' Steering Committee members shall utilize communication channels approved by the membership for discussing WCU business. These channels must be accessible to all members in good standing for the purpose of viewing and commenting on Steering Committee communications.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.3 Transparency:'
              },
              {
                kind: 'text',
                text: ' Steering Committee members shall strive to maintain transparency in their decision-making process, avoiding any appearance of decisions being made in closed channels. Justifications and reasoning for decisions should be provided to the general membership as appropriate.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-5',
        number: '5',
        title: 'BUDGET',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Steering Committee shall possess the authority, by majority vote, to allocate up to 10% of the chapter’s unallocated funds per month, with the amount determined by the balance following the previous General Body Meeting. Any such decision must be promptly communicated to the membership, accompanied by a rationale explaining the necessity of expending the funds prior to obtaining approval at a regularly scheduled General Meeting.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-6',
        number: '6',
        title: 'TREASURER',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Treasurer shall manage the financial affairs of Working Class Unity, including the care and custody of general funds, securities, properties, and assets.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.1 Financial Management:'
              },
              {
                kind: 'text',
                text: ' The Treasurer shall ensure that the funds and securities are deposited in banks, trust companies, or depositories designated by the Steering Committee. At the direction of the Steering Committee, the Treasurer will ensure disbursement and disposal of the same, taking proper vouchers for such disbursements. The Treasurer will have the discretion to reimburse expenses up to thirty dollars ($30).'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.2 Record Keeping:'
              },
              {
                kind: 'text',
                text: ' The Treasurer shall maintain accurate books of account in accordance with commonly accepted accounting principles. These records shall include the amount of all monies, funds, securities, properties, and assets in the Treasurer’s custody, as well as the amount of disbursements made and the disposition of properties. The Treasurer shall exhibit these books and records when required by the Steering Committee or government agency of appropriate regulatory jurisdiction pursuant to law and shall make this information readily available to the Membership, without requiring them to make a request.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.3 Dues Collection:'
              },
              {
                kind: 'text',
                text: ' The Treasurer shall be responsible for the collection of any local dues or pledges.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.4 Financial Reporting:'
              },
              {
                kind: 'text',
                text: ' The Treasurer shall prepare and present a yearly financial report.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.5 Compliance:'
              },
              {
                kind: 'text',
                text: ' The Treasurer shall sign or countersign all certificates, contracts, or other instruments of Working Class Unity with the approval of the Steering Committee, except where otherwise designated in these bylaws. The Treasurer shall provide reports as needed to ensure the completion of all appropriate reporting to local, state, or federal agencies.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.6 Fundraising:'
              },
              {
                kind: 'text',
                text: ' The Treasurer may initiate fundraising efforts or offer advice with respect to fundraising efforts initiated elsewhere in the organization.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-7',
        number: '7',
        title: 'SECRETARY',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Secretary shall oversee the maintenance of organizational documents, minutes, and other records, manage the agenda creation process for General Meetings and Steering Committee Meetings, schedule meetings, update the calendar, and manage access to organizational accounts.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-8',
        number: '8',
        title: 'MEMBERSHIP COORDINATOR',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Membership Coordinator shall be responsible for building a team of mentors, implementing the membership pipeline, and facilitating work aimed at politically educating the chapter membership.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-9',
        number: '9',
        title: 'CAMPAIGNS COORDINATOR',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Campaigns Coordinator shall represent the Steering Committee at Campaign and Campaign Development Working Group meetings, facilitate the creation of Campaign proposals and the process of campaign development, and organize political education events related to the campaigns.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-10',
        number: '10',
        title: 'RECALL AND REMOVAL',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Any member can move to have any Officer or Steering Committee member removed by a two-thirds vote, with or without cause. This vote must take place at the General Meeting. A Steering Committee member will be considered to have resigned if they fail to attend 50% of the Steering Committee meetings over a three-month period, unless a written explanation is provided and accepted by a majority vote of the Steering Committee.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-11',
        number: '11',
        title: 'VACANCIES',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'In the event of vacancies among Officers or members of the Steering Committee due to death, resignation, or other circumstances, the Steering Committee may appoint temporary replacements until a General Meeting vote is held to either ratify the appointment or hold elections for a new member. This replacement member will not have a vote on the Steering Committee until ratification of the appointment or an election is held.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-12',
        number: '12',
        title: 'RECORD KEEPING',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The organization shall maintain accurate and complete records of its meetings, financial transactions, membership information, and any other relevant documents. The Secretary shall be responsible for maintaining meeting minutes and ensuring their proper storage. The Treasurer shall be responsible for maintaining financial records and ensuring their proper storage. The Membership Coordinator shall be responsible for maintaining membership information and ensuring its proper storage. All records shall be kept for a period of no less than seven (7) years or as required by applicable law.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vi-section-13',
        number: '13',
        title: 'LEGAL DOCUMENTS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'In the context of local, state, federal, and other regulatory documents, the Campaign Coordinator shall hold the title of Chair/President, while the Membership Coordinator shall hold the title of Vice-Chair/Vice-President. These designations are solely for documentation purposes and do not imply any extra duties or privileges within the organization.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-vii',
    number: 'VII',
    title: 'CAMPAIGNS',
    blocks: [],
    sections: [
      {
        id: 'article-vii-section-1',
        number: '1',
        title: 'FOCUS CAMPAIGNS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The primary ongoing work of Working Class Unity shall be conducted through democratically chosen, membership-led focus campaigns, hereinafter referred to as “campaigns.”'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Campaigns shall be strategically focused, with specific goals to advance socialism and build power for the working class. They should involve organizing for power and mass mobilization of WCU’s membership and the broader working class in San Joaquin County. Campaigns represent significant long-term commitments of time and resources by WCU. At any given time, WCU shall maintain no more than two active focus campaigns.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vii-section-2',
        number: '2',
        title: 'CAMPAIGN FORMATION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Campaigns shall be voted on by the Membership. A two-thirds majority vote is required for a campaign to be adopted. This vote must take place at a General Meeting. An upcoming campaign proposal vote must be announced at a General Meeting at least one General Meeting in advance.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'If the number of Focus Campaign proposals exceeds the available slots, a series of voting rounds will be conducted. In each round, the proposal receiving the fewest votes will be eliminated until the number of remaining proposals matches the number of available Focus Campaign slots. Each of these remaining Focus Campaign proposals will then be subject to a final vote, requiring a two-thirds majority to be formally adopted.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vii-section-3',
        number: '3',
        title: 'CAMPAIGN OPERATION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Upon approval of a new campaign, nominations for Campaign Leadership will open. Campaigns will operate without formal leadership for their first month. Campaign Leadership shall consist of at least one member but may be expanded by the Membership during the campaign formation process.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.1. Initial Leadership Responsibilities:'
              },
              {
                kind: 'text',
                text: ' During the first month, the Campaigns Coordinator will be responsible for managing basic administrative tasks of campaign operation.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.2. Election of Campaign Leadership:'
              },
              {
                kind: 'text',
                text: ' Campaign leadership will be elected by a simple majority of Members in good standing attending the General Meeting one month after the approval of the Campaign. This leadership will be responsible for overseeing the ongoing operations of the campaign.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.3. Eligibility for Campaign Leadership:'
              },
              {
                kind: 'text',
                text: ' Any Member in good standing is eligible to run for Campaign Leadership once a Campaign has been authorized.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.4. Reapproval and Leadership Election:'
              },
              {
                kind: 'text',
                text: ' Every six months, a campaign must be reapproved by a simple majority vote and new campaign leaders elected. This vote must take place at a General Meeting. There are no term limits for campaign leadership. A campaign may be reapproved with significant changes to the campaign operations or structure; these changes must be clearly communicated to the General Membership at least two weeks prior to the vote.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.5. Reauthorization and Leadership Transition:'
              },
              {
                kind: 'text',
                text: ' Reauthorized Campaigns will elect their leadership at the same meeting in which reauthorization takes place. The Membership Coordinator and outgoing Campaign Leadership share responsibility for finding candidates during the preceding month and are responsible for assisting new leadership with the transition during the first month post-reauthorization.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '3.6. Budget Approval:'
              },
              {
                kind: 'text',
                text: ' An initial budget will be voted on by the Membership when a campaign is adopted. The budget will be adopted by a majority vote. This vote must take place at a General Meeting. Additional budget requests may be approved by the Membership at General Meetings in the same fashion.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vii-section-4',
        number: '4',
        title: 'CAMPAIGN PRIVILEGES',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'An adopted campaign signifies a democratically agreed-upon priority of WCU’s membership. It represents a collective commitment to specific goals and strategies.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.1. Campaign Autonomy'
              },
              {
                kind: 'text',
                text: ': Campaign leadership is authorized to plan and execute actions, mobilize membership, issue statements, and undertake other necessary measures to achieve the goals and objectives approved by the membership upon the adoption of the campaign. These decisions must be approved by the Campaign Coordinator.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '4.2. Amendments to Campaign Plans:'
              },
              {
                kind: 'text',
                text: ' If a campaign wishes to deviate significantly from the plan that was initially proposed and approved by the membership, the proposed changes must be presented at a General Meeting. The membership shall then vote on the proposed changes through a majority vote to approve or reject the amendments, ensuring that the deviation aligns with the group’s collective decision-making process.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-vii-section-5',
        number: '5',
        title: 'CAMPAIGN CLOSURE',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'A campaign shall be terminated upon the completion of its stated goals or upon the expiration of its six-month authorization, unless renewed by the membership.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '5.1. Mid-term Termination Proposal:'
              },
              {
                kind: 'text',
                text: ' Any member may submit a proposal to terminate a campaign mid-term to the Steering Committee with the co-signatures of at least quorum + 1 Members. The Steering Committee shall provide advance notice of the proposal to the Membership at least two weeks prior to the General Meeting. The proposal shall be presented at the following General Meeting, and a two-thirds majority vote will be required to approve the termination.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '5.2. Campaign Suspension:'
              },
              {
                kind: 'text',
                text: ' A Campaign may be suspended by a two-thirds vote of both the combined Campaign Leadership and the Steering Committee.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'strong',
                text: '5.3. Resumption or Termination of Suspended Campaigns:'
              },
              {
                kind: 'text',
                text: ' A Campaign that has been suspended according to the process outlined above may be resumed or terminated by a two-thirds vote. The vote must take place at the following General Meeting.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-viii',
    number: 'VIII',
    title: 'SIDE-QUESTS',
    blocks: [
      {
        kind: 'paragraph',
        parts: [
          {
            kind: 'text',
            text: 'WCU may engage in activities designated as “Side-Quests” that are not subject to the cap on Focus Campaigns. These activities shall be limited in scope and resource commitment compared to Focus Campaigns. The Steering Committee shall be responsible for coordinating and accomplishing the Side-Quest, adhering to the language and intent of the original proposal during implementation.'
          }
        ]
      }
    ],
    sections: [
      {
        id: 'article-viii-section-1',
        number: '1',
        title: 'PROPOSAL OF SIDE-QUESTS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Any member can propose, advocate for, or initiate a Side-Quest that meets the above criteria at any time. Membership is responsible for judging if the activity is better suited for a campaign and should, in this case, vote at a General Meeting either to begin a campaign development working group, which will consist of two members, with the goal of developing the activity into a campaign, or else vote to end the non-campaign activity. In addition, Side-Quests that are not democratically approved, by the Steering Committee or Membership, cannot be represented as a WCU activity to outside groups.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-viii-section-2',
        number: '2',
        title: 'DEMOCRATIC APPROVAL OF SIDE-QUESTS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'A Side-Quest can gain democratic approval by being brought as a proposal to the Membership at a General Meeting. The proposal will require a simple majority of general meeting attendees.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'For urgent actions between General Meetings, any member can bring a proposal to the Membership. The action can be approved with quorum plus one approving the action, or three members in good standing, whichever number is higher. Steering Committee members cannot make up half or majority of the votes.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-ix',
    number: 'IX',
    title: 'COMMITTEES',
    blocks: [],
    sections: [
      {
        id: 'article-ix-section-1',
        number: '1',
        title: 'THE EDUCATION COMMITTEE',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Education Committee shall operate under the supervision of the Membership Coordinator. Its responsibilities include overseeing the educational and political activities of the chapter.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-ix-section-2',
        number: '2',
        title: 'THE MEMBERSHIP COMMITTEE',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Membership Committee shall be managed by the Membership Coordinator. The committee is responsible for member and non-member outreach, as well as the development and training of members.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-ix-section-3',
        number: '3',
        title: 'TEMPORARY WORKING GROUPS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Temporary working groups may be authorized by the Membership at a General Meeting. Such groups should not necessitate a significant, ongoing commitment of resources from the membership.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-ix-section-4',
        number: '4',
        title: 'COMMITTEE MEMBERSHIP',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Except for the Steering Committee and Campaign Leadership Committees, which are entirely elected entities, members can join other committees by attending the respective committee’s meetings.'
              }
            ]
          }
        ]
      }
    ]
  },
  {
    id: 'article-x',
    number: 'X',
    title: 'MISCELLANEOUS',
    blocks: [],
    sections: [
      {
        id: 'article-x-section-1',
        number: '1',
        title: 'APPOINTMENT OF AGENTS OR SPECIAL POSITIONS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The Steering Committee may appoint agents, officers, or other specific roles as needed, subject to the approval of the Membership. Appointments shall be made only after a two-thirds ratification at a General Meeting.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Appointed agents, officers, or other roles shall report to the Steering Committee and shall not hold any voting rights or other privileges on the Steering Committee beyond those held by Members. They shall perform their duties as directed by the Steering Committee and in accordance with the goals and objectives of the organization.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-x-section-2',
        number: '2',
        title: 'INDEMNIFICATION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'WCU shall, to the extent legally permissible, indemnify each person who may serve or has served as an officer, director, or employee of the corporation against all expenses and liabilities incurred in connection with any threatened, pending, or completed action, suit, or proceeding arising from their service in such capacity.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'No indemnification shall be provided for any person with respect to any matter in which they have been adjudicated to have acted in bad faith or against the best interest of the organization. Any compromise or settlement payment must be approved by a two-third vote of the Steering Committee who are not parties to the proceeding.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-x-section-3',
        number: '3',
        title: 'CHANGES TO THE BYLAWS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Members shall have the power to approve changes to the Bylaws. Amendments to the Bylaws shall be announced to the members one meeting in advance of any vote. Changes may be adopted by a vote of two-thirds of the members present.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: '3.1. Amendments to Proposed Bylaw Changes: Once a bylaw change has been announced, any member may submit amendments to that proposal. Amendments must be announced to the Membership two weeks before the vote to adopt the proposal. Individual members shall submit their amendments to the Steering Committee, who shall be responsible for announcing them to the general Membership. The Steering Committee may also determine by a vote that a proposed amendment is actually a separate bylaw change, and thus should go through the standard bylaw amendment process. Membership can overrule such a decision from the Steering Committee by a simple majority vote at a General Meeting before the final vote is held.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-x-section-4',
        number: '4',
        title: 'COMPLIANCE WITH IRS GUIDELINES AND STATE REGULATIONS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'WCU shall not engage in activity prohibited by the IRS guidelines established for 501(c)(4) organizations or similar rules established by the state of California.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'The fiscal year of the organization shall begin on the first day of January and end on the last day of December in each year.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-x-section-5',
        number: '5',
        title: 'DISSOLUTION',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'WCU may be dissolved by a motion approved by two-thirds of the Steering Committee and confirmed by a two-thirds vote. Both votes must take place at a General Meeting. Upon confirmation of the dissolution, the Steering Committee shall designate an appropriate agent to complete the dissolution of the organization. The designated agent shall be responsible for ensuring that all financial and legal issues are properly resolved and that any remaining assets of the organization are distributed in accordance with applicable laws and regulations.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-x-section-6',
        number: '6',
        title: 'ACCESS TO MEMBER LISTS',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Access to member lists or databases containing identifying information shall be restricted in the following ways:'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: '6.1. Steering Committee Access: The Steering Committee shall have full access to member data.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: '6.2. Access for Other Members: Other members of WCU may be granted access to member data at the discretion of the Steering Committee, only if one or more of the criteria are met:'
              }
            ]
          },
          {
            kind: 'unordered-list',
            items: [
              [
                {
                  kind: 'text',
                  text: 'The member has been a member of WCU for greater than one (1) year.'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'The member has attended no fewer than four (4) meetings in the last six (6) months, including Campaign, Committee, and General Meetings.'
                }
              ],
              [
                {
                  kind: 'text',
                  text: 'The member list being provided contains at most 50 entries.'
                }
              ]
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'When members are granted access to member information, they shall be restricted to the information necessary to carry out their designated tasks.'
              }
            ]
          },
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: '6.3. Requests for Member Information: Requests for member information must have an explicit political purpose, and the purpose of the request must be recorded by the Steering Committee and made available to the Membership.'
              }
            ]
          }
        ]
      },
      {
        id: 'article-x-section-7',
        number: '7',
        title: 'BYLAW REVIEW',
        blocks: [
          {
            kind: 'paragraph',
            parts: [
              {
                kind: 'text',
                text: 'Every six months, the Steering Committee shall review the Bylaws, recommend changes, and recommend changes to the Membership Pipeline to clarify knowledge and skills that need to be transferred and delegated.'
              }
            ]
          }
        ]
      }
    ]
  }
] as const satisfies readonly BylawsArticle[]
