// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
// add openzeppelin counter to count the number of works
import "@openzeppelin/contracts/utils/Counters.sol";
import "./mocks/MockToken.sol";
// Uncomment this line to use console.log
//import "hardhat/console.sol";

/**
* @title Controller
* @dev This contract is used to control the financial backend of a dApp.
* It is used to create works and to pay the workers.
* The core idea is that is contract serve as hube to a dApp that manage
* customers and works.
* The dApp will be able to create works and pay the workers using this contract.
*/

contract Controller is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // # GENERAL CONFIGURATION
    using Counters for Counters.Counter;

    Counters.Counter private _projectIds;
    Counters.Counter private _bidIds;

    // The token used to pay the workers
    IERC20 public depositToken;
    error EtherNotAccepted();

    // # WORKERS MANAGEMENT
        // workers errors:
        error WorkerAlreadyExists();
        // workers event
        event WorkerRegistered(address indexed worker, string name);

        // store info about workers
        struct WorkerInfo {
            string name;
            address paymentAddress;
            uint256 since;
            uint256 projectsCount;
        }

        mapping(address => WorkerInfo) public workerInfo;
        // map of works by name, just to check if exists
        mapping(string => bool) private workersNames;

        // array of workers:
        address[] public workerByAddress;

    // # CLIENT MANAGEMENT
        // clients errors:
        error ClientAlreadyExists();
        // clients event
        event ClientRegistered(address indexed clientAddress, string name);

        // store info about clients
        struct ClientInfo {
            string name;
            address clientAddress;
            uint256 since;
            uint256 projectsCount;
        }

        // map of clients by address:
        mapping(address => ClientInfo) public clientInfo;

        // map of clients by name, just to check if exists
        mapping(string => bool) private clientByName;

        // array of clients:
        address[] private clientAddress;

    // # PROJECTS MANAGEMENT


        // enum of project stages
        enum ProjectStage {
            OpenToBids,
            BidAccepted
        }

        // project events
        event ProjectCreated(
            address indexed clientAddress,
            uint256 indexed projectId,
            uint256 maxAcceptableAmount,
            uint256 maxAcceptableDeadline,
            string description
        );

        event BidToProject(
            uint256 indexed projectId,
            address indexed worker,
            uint256 proposedBudget,
            uint256 proposedDeadline
        );

        // error messages
        error ProjectAlreadyExists();
        error TooHighProposedBudget();
        error BidsAreClosed();
        error BidDoesNotBelongToProject();
        error ProjectNotOpenToBids();
        error ProjectDoesNotExist();

        // store info about projects
        struct ProjectInfo {
            address clientAddress;
            uint256 maxAcceptableAmount;
            uint256 maxAcceptableDeadline;
            string description;
            ProjectStage stage;
            uint addedAt;
            uint bidAccepted;
            uint bidAcceptedAt;
            uint bidAcceptedAmount;
            uint bidAcceptedDeadline;
        }

        // map of projects info:
        mapping(uint => ProjectInfo) public projects;

        // map of array of projects by owner:
        mapping(address => uint256[]) public projectsByOwner;

        // control projects creation by description and by client:
        mapping(address => mapping(string=>bool)) private projectsNameByClient;

    // # BIDS MANAGEMENT

        error OnlyProjectOwnerCanAcceptBids();
        error TooHighProposedDeadline();

        // event about an accepted bid
        event BidAccepted(
            uint256 indexed projectId,
            uint256 indexed bidId,
            uint256 proposedBudget,
            uint256 proposedDeadline,
            uint acceptedIn
        );

        // map of bids by bid id
        struct BidInfo {
            uint projectId;
            uint bidId;
            address worker;
            uint256 proposedBudget;
            uint256 proposedDeadline;
            bool accepted;
            uint addedAt;
            uint acceptedAt;
        }

        // map of bids by project id
        mapping(uint256 => uint256[]) public bidsByProjectId;

        // map of bid for easy access:
        mapping(uint256 => BidInfo) private bidsById;


    constructor(address payable _depositToken) {
        depositToken = IERC20(_depositToken);
    }

    // # CLIENT MANAGEMENT
    function registerAsClient(string memory _name) external nonReentrant {

        // check if client already exists
        if (clientByName[_name]) {
            revert ClientAlreadyExists();
        }
        clientByName[_name] = true;

        ClientInfo memory client = ClientInfo(
            _name,
            msg.sender,
            block.timestamp, 
            0);

        // add client to list of clients to allow iteration
        clientAddress.push(msg.sender);

        clientInfo[msg.sender] = client;

        emit ClientRegistered(msg.sender, _name);

    }

    // # WORKER MANAGEMENT

    function registerAsWorker(string memory _name) external nonReentrant {

        // check if work already exists
        if (workersNames[_name]) {
            revert WorkerAlreadyExists();
        }

        // create a new work
        workersNames[_name] = true;
        WorkerInfo memory worker = WorkerInfo(
            _name,
            msg.sender,
            block.timestamp,
            0
        );
        workerByAddress.push(msg.sender);
        workerInfo[msg.sender] = worker;

        emit WorkerRegistered(msg.sender, _name);

    }

    // prevent sending ether to this contract:
    fallback() external payable {
        revert EtherNotAccepted();
    }

    receive() external payable {
        revert EtherNotAccepted();
    }

    // # PROJECTS MANAGEMENT
    function createProject(
        uint256 _maxAcceptableAmount,
        uint256 _maxAcceptableDeadline,
        string memory _description
    ) external nonReentrant {

        // check if project already exists by projectsNameByClient
        if (projectsNameByClient[msg.sender][_description]) {
            revert ProjectAlreadyExists();
        }
        projectsNameByClient[msg.sender][_description] = true;

        // create a project id
        uint256 _projectId = _projectIds.current();

        // add this project id to the list of projects of owner:
        projectsByOwner[msg.sender].push(_projectId);

        // increment owner projects count
        clientInfo[msg.sender].projectsCount++;

        // create a new project
        ProjectInfo memory project = ProjectInfo(
            msg.sender,
            _maxAcceptableAmount,
            _maxAcceptableDeadline,
            _description,
            ProjectStage.OpenToBids, // stage
            block.timestamp, // addedAt
            0, // bidAccepted
            0, // bidAcceptedAt
            0, // bidAcceptedAmount
            0 // bidAcceptedDeadline
        );

        projects[_projectId] = project;

        emit ProjectCreated(
            msg.sender,
            _projectId,
            project.maxAcceptableAmount,
            project.maxAcceptableDeadline,
            project.description
        );
    }

    // # PUBLIC WORKERS FUNCTIONS

    // allow any worker to bid to a project:
    function bidToProject(uint projectId, uint proposedBudget, uint proposedDeadline) external nonReentrant {

        // get project info
        ProjectInfo storage project = projects[projectId];

        // check if project exists
        if ( project.clientAddress == address(0) ) {
            revert ProjectDoesNotExist();
        }

        // check if bids are open:
        if (project.stage != ProjectStage.OpenToBids) {
            revert BidsAreClosed();
        }

        // get worker by address from global storage
        //WorkerInfo memory worker = workerInfo[msg.sender];

        // check if proposed budget is not greater than project budget:
        if (proposedBudget < project.maxAcceptableAmount) {
            revert TooHighProposedBudget();
        }

        // check deadline is not greater than project deadline:
        if (proposedDeadline > project.maxAcceptableDeadline) {
            revert TooHighProposedDeadline();
        }

        // get next bid id
        uint256 _bidId = _bidIds.current();

        // build info
        BidInfo memory bidInfo = BidInfo(
            projectId,
            _bidId,
            msg.sender,
            proposedBudget,
            proposedDeadline,
            false,
            block.timestamp,
            0
        );

        // add this bid id to the list of bids of project:
        bidsByProjectId[projectId].push(_bidId);

        // store this bid info in a map for easy access:
        bidsById[_bidId] = bidInfo;

        emit BidToProject(
            projectId,
            msg.sender,
            proposedBudget,
            proposedDeadline);
    }

    function acceptBid(uint bidId) external nonReentrant {

        // get bid info:
        BidInfo storage bidInfo = bidsById[bidId];

        // get project info from bid:
        ProjectInfo storage project = projects[bidInfo.projectId];

        // get client info from project:
        ClientInfo storage client = clientInfo[msg.sender];

        // get worker info by bid id
        WorkerInfo storage worker = workerInfo[bidInfo.worker];

        // check if project exists and is owned by client:
        if(project.clientAddress != msg.sender) {
            revert ProjectDoesNotExist();
        }

        // check project stage is open for bids:
        if (project.stage == ProjectStage.OpenToBids) {
            revert ProjectNotOpenToBids();
        }

        // make sure only project owner can accept bids:
        if (client.clientAddress != msg.sender) {
            revert OnlyProjectOwnerCanAcceptBids();
        }

        // set project stage to bid accepted, to prevent
        // new bids to be accepted:
        project.stage = ProjectStage.BidAccepted;

        // set bid info in the current project from the following worker:
        project.bidAccepted = bidId;
        project.bidAcceptedAt = block.timestamp;
        project.bidAcceptedAmount = bidInfo.proposedBudget;
        project.bidAcceptedDeadline = bidInfo.proposedDeadline;

        // set bid accepted info:
        bidInfo.accepted = true;
        bidInfo.acceptedAt = block.timestamp;

        // increment worker projects count
        worker.projectsCount++;

        // transfer deposit from client to this contract to pay worker:
        depositToken.safeTransferFrom(
            msg.sender,
            address(this),
            bidInfo.proposedBudget
        );

        emit BidAccepted(
            bidInfo.projectId,
            bidId,
            bidInfo.proposedBudget,
            bidInfo.proposedDeadline,
            block.timestamp
        );

    }

    // # PUBLIC PROJECT INTERACTION FUNCTIONS

    // # PUBLIC VIEWS
    function getWorkerInfoByAddress(address _workerAddress)
        external
        view
        returns (WorkerInfo memory worker)
    {
        return workerInfo[_workerAddress];
    }


    function getClientInfoByAddress(address _clientAddress)
        external
        view
        returns (ClientInfo memory client)
    {
        return clientInfo[_clientAddress];
    }

    function getProjectIdsByOwner(address owner) external view returns (uint256[] memory) {
        return projectsByOwner[owner];
    }

    function getProjectInfoById(uint256 _projectId)
        external
        view
        returns (ProjectInfo memory)
    {
        return projects[_projectId];
    }

    function getProjectBids(uint256 _projectId)
        external
        view
        returns (uint256[] memory)
    {
        return  bidsByProjectId[_projectId];
    }

    // get info about the accepted bid by project id:
    function getAcceptedBidInfo(uint256 _projectId)
        external
        view
        returns (BidInfo memory)
    {
        return bidsById[projects[_projectId].bidAccepted];
    }
}
